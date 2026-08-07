#!/usr/bin/env python3

import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


SETTLE_SECONDS = 0.35
TIMEOUT_SECONDS = 30.0


def configure_terminal(file_descriptor: int) -> None:
    dimensions = struct.pack("HHHH", 30, 100, 0, 0)
    fcntl.ioctl(file_descriptor, termios.TIOCSWINSZ, dimensions)


def read_available(file_descriptor: int) -> bytes | None:
    try:
        return os.read(file_descriptor, 65536)
    except OSError as error:
        if error.errno == errno.EIO:
            return None
        raise


def terminate_child(process_id: int) -> int:
    waited_process, status = os.waitpid(process_id, os.WNOHANG)
    if waited_process == 0:
        os.kill(process_id, signal.SIGKILL)
        _, status = os.waitpid(process_id, 0)
    return os.waitstatus_to_exitcode(status)


def drive(config: dict[str, object]) -> tuple[bytes, int]:
    arguments = [str(value) for value in config["arguments"]]
    working_directory = str(config["workingDirectory"])
    input_bytes = base64.b64decode(str(config["inputBase64"]))
    process_id, file_descriptor = pty.fork()
    if process_id == 0:
        os.chdir(working_directory)
        environment = dict(os.environ)
        if config.get("home"):
            environment["HOME"] = str(config["home"])
        environment.pop("NO_COLOR", None)
        environment["COLORTERM"] = "truecolor"
        environment["FORCE_COLOR"] = "3"
        environment["TERM"] = "xterm-truecolor"
        os.execvpe(arguments[0], arguments, environment)
        os._exit(127)

    configure_terminal(file_descriptor)
    output = bytearray()
    started_at = time.monotonic()
    last_output_at = started_at
    input_sent = False
    received_output = False

    while time.monotonic() - started_at < TIMEOUT_SECONDS:
        readable, _, _ = select.select([file_descriptor], [], [], 0.05)
        if readable:
            data = read_available(file_descriptor)
            if data is None or not data:
                break
            output.extend(data)
            received_output = True
            last_output_at = time.monotonic()
            continue
        if (
            received_output
            and not input_sent
            and time.monotonic() - last_output_at >= SETTLE_SECONDS
        ):
            os.write(file_descriptor, input_bytes)
            input_sent = True

    os.close(file_descriptor)
    return bytes(output), terminate_child(process_id)


if __name__ == "__main__":
    raw_output, exit_code = drive(json.loads(sys.argv[1]))
    sys.stdout.buffer.write(raw_output)
    sys.exit(exit_code)
