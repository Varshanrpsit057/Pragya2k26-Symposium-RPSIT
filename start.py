#!/usr/bin/env python3
"""Start every PRAGYA 2026 server with one command.

    py start.py              install packages if needed, build, start all three servers
    py start.py --no-build   skip the builds (uses the last build; builds only if there is none)
    py start.py --host       also make the sites reachable from phones on your network
    py start.py --open       open the sites in your browser once they are ready

    Registration API (+ built site):        http://localhost:8787
    Dev server (live reload while editing):   http://localhost:5173
    Production preview (the built site):      http://localhost:4173

The dev server and the preview send registrations to the API, so the form works on all three.
A server that stops unexpectedly is restarted. Press Ctrl+C to stop everything.
Uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent
IS_WINDOWS = os.name == "nt"
MIN_NODE_MAJOR = 22
READY_TIMEOUT_S = 60
# How long to wait for the API to connect to Google after it starts listening.
GOOGLE_TIMEOUT_S = 30
MAX_RESTARTS = 5
API_ENTRY = ROOT / "dist-server" / "node.js"

# Colours only in a real terminal (and never when NO_COLOR is set).
USE_COLOR = sys.stdout.isatty() and "NO_COLOR" not in os.environ


def ansi(code: str) -> str:
    return f"\033[{code}m" if USE_COLOR else ""


RESET, BOLD, DIM = ansi("0"), ansi("1"), ansi("2")
RED, GREEN, YELLOW, BLUE, CYAN, MAGENTA = ansi("31"), ansi("32"), ansi("33"), ansi("34"), ansi("36"), ansi("35")


@dataclass(frozen=True)
class Server:
    name: str
    label: str
    port: int
    color: str
    # A path that answers with JSON once the server is ready; None: an open port is enough.
    health: str | None = None

    @property
    def url(self) -> str:
        return f"http://localhost:{self.port}"


API = Server("api", "Registration API", 8787, BLUE, "/api/health")
SERVERS = (
    API,
    Server("dev", "Dev server (live reload)", 5173, CYAN),
    Server("preview", "Production preview", 4173, MAGENTA),
)

print_lock = threading.Lock()


def say(message: str = "") -> None:
    with print_lock:
        print(message, flush=True)


def fail(message: str) -> NoReturn:
    say(f"{RED}{message}{RESET}")
    sys.exit(1)


def find_npm() -> str:
    npm = shutil.which("npm")
    if not npm:
        fail("npm was not found. Install Node.js (https://nodejs.org) and try again.")
    return npm


def find_node() -> str:
    node = shutil.which("node")
    if not node:
        fail("Node.js was not found. Install it from https://nodejs.org and try again.")
    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
    try:
        major = int(version.lstrip("v").split(".")[0])
    except ValueError:
        return node
    if major < MIN_NODE_MAJOR:
        fail(f"Node.js {version} is too old. Version {MIN_NODE_MAJOR} or newer is required.")
    return node


def port_in_use(port: int) -> bool:
    """True if something already accepts connections on localhost:port (IPv4 or IPv6)."""
    try:
        with socket.create_connection(("localhost", port), timeout=0.4):
            return True
    except OSError:
        return False


def read_health(server: Server) -> dict | None:
    """The server's health answer, or None if it is not (yet) our server answering."""
    url = f"http://127.0.0.1:{server.port}{server.health}"
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Registration switched off still answers (503 with JSON): the server is up.
        try:
            return json.load(error)
        except ValueError:
            return None
    except (OSError, ValueError):
        return None


def is_ready(server: Server) -> bool:
    if server.health is None:
        return port_in_use(server.port)
    return read_health(server) is not None


def run_step(npm: str, args: list[str], description: str) -> None:
    say(f"{BOLD}> {description}{RESET}")
    result = subprocess.run([npm, *args], cwd=ROOT)
    if result.returncode != 0:
        fail(f"'npm {' '.join(args)}' failed (exit code {result.returncode}).")


def server_command(server: Server, npm: str, node: str, expose: bool) -> list[str]:
    if server is API:
        # Node directly (not through npm), so Ctrl+Break reaches it and it can stop cleanly.
        return [node, str(API_ENTRY)]
    args = [npm, "run", server.name, "--", "--port", str(server.port), "--strictPort"]
    if expose:
        args.append("--host")
    return args


def start_server(command: list[str], server: Server) -> subprocess.Popen[str]:
    # Each server gets its own process group, so Ctrl+C reaches only this script,
    # which then shuts the servers down itself (avoids npm's "Terminate batch job?" prompt).
    options: dict = {}
    if IS_WINDOWS:
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True

    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        **options,
    )
    threading.Thread(target=relay_output, args=(server, process), daemon=True).start()
    return process


def relay_output(server: Server, process: subprocess.Popen[str]) -> None:
    """Prints a server's output with a coloured [name] prefix."""
    assert process.stdout is not None
    prefix = f"{server.color}[{server.name}]{RESET}"
    for line in process.stdout:
        line = line.rstrip()
        if line:
            say(f"{prefix} {line}")


def wait_until_ready(server: Server, process: subprocess.Popen[str]) -> bool:
    deadline = time.monotonic() + READY_TIMEOUT_S
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        if is_ready(server):
            return True
        time.sleep(0.25)
    return False


def report_registration() -> None:
    """Says whether the API reached Google, once it has tried (it connects right after starting)."""
    deadline = time.monotonic() + GOOGLE_TIMEOUT_S
    health = read_health(API)
    while health and health.get("status") == "starting" and time.monotonic() < deadline:
        time.sleep(0.5)
        health = read_health(API)
    status = (health or {}).get("status")
    if status == "ready":
        say(f"{GREEN}Registration is ON: signed in to Google and loaded the registration sheet.{RESET}")
        say(f"{DIM}To check the Drive folder and Gmail too: npm run google:check -- --send-test-email{RESET}")
    elif (health or {}).get("code") == "NOT_CONFIGURED":
        say(f"{YELLOW}Registration is OFF: Google settings are missing in .env (see .env.example), then run npm run google:auth.{RESET}")
    else:
        say(
            f"{YELLOW}The API is running but could not reach Google yet; registrations will keep retrying."
            f" See the [api] lines above and run: npm run google:check{RESET}"
        )


def stop(process: subprocess.Popen[str], graceful: bool) -> None:
    """Stops a server and every process it started (npm -> node)."""
    if process.poll() is not None:
        return
    if IS_WINDOWS:
        if graceful:
            # Lets the API finish the registrations it is saving before it exits.
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
                process.wait(timeout=12)
                return
            except (OSError, subprocess.TimeoutExpired):
                pass
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        process.wait(timeout=5)
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            process.wait(timeout=12 if graceful else 5)
        except ProcessLookupError:
            return
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start the PRAGYA 2026 registration API, dev server and production preview.",
    )
    parser.add_argument("--no-build", action="store_true", help="skip the builds (uses the last build)")
    parser.add_argument(
        "--host",
        action="store_true",
        help="listen on your network too, so phones on the same Wi-Fi can open the site",
    )
    parser.add_argument("--open", action="store_true", help="open the sites in the browser")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    # Vite prints symbols such as arrows; never crash on a console that cannot show them.
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(errors="replace")
    if IS_WINDOWS and USE_COLOR:
        os.system("")  # turns on ANSI colours in the Windows console

    say(f"\n{BOLD}PRAGYA 2026{RESET} {DIM}starting servers in {ROOT}{RESET}\n")
    node = find_node()
    npm = find_npm()

    if not (ROOT / "node_modules").is_dir():
        run_step(npm, ["install"], "Installing packages (first run only)")

    to_start: list[Server] = []
    for server in SERVERS:
        if not port_in_use(server.port):
            to_start.append(server)
        elif server.health and read_health(server) is None:
            fail(f"Port {server.port} is used by another program, so the {server.label} cannot start. Close it and try again.")
        else:
            say(f"{YELLOW}{server.label} is already running at {server.url}, so it was left as is (restart it to pick up changes).{RESET}")
    if not to_start:
        say(f"\n{GREEN}Everything is already running.{RESET}")
        return 0

    if API in to_start and (not args.no_build or not API_ENTRY.is_file()):
        run_step(npm, ["run", "build:server"], "Building the registration API")
    starting_preview = any(server.name == "preview" for server in to_start)
    needs_build = not (ROOT / "dist" / "index.html").is_file()
    if (starting_preview or API in to_start) and (not args.no_build or needs_build):
        reason = "no previous build found" if args.no_build else "so the preview shows your latest changes"
        run_step(npm, ["run", "build"], f"Building the production site ({reason})")

    processes: list[tuple[Server, subprocess.Popen[str]]] = []
    commands = {server.name: server_command(server, npm, node, args.host) for server in to_start}
    restarts = {server.name: 0 for server in to_start}

    def shut_down(*_: object) -> None:
        raise KeyboardInterrupt

    if not IS_WINDOWS:
        signal.signal(signal.SIGTERM, shut_down)

    try:
        # The API first: the other two forward registrations to it.
        for server in to_start:
            say(f"{BOLD}> Starting {server.label.lower()}{RESET}")
            process = start_server(commands[server.name], server)
            processes.append((server, process))
            if not wait_until_ready(server, process):
                say(f"{RED}{server.label} did not start. See the [{server.name}] output above.{RESET}")
                return 1

        say(f"\n{GREEN}{BOLD}All servers are running:{RESET}")
        for server in SERVERS:
            say(f"  {server.color}{server.label:<26}{RESET} {server.url}")
        if args.host:
            say(f"  {DIM}Phones on the same Wi-Fi: use the 'Network' addresses printed above.{RESET}")
        if API in to_start or port_in_use(API.port):
            report_registration()
        say(f"\n{DIM}Press Ctrl+C to stop.{RESET}\n")

        if args.open:
            for server in SERVERS[1:]:
                webbrowser.open(server.url)

        # Keep running until the user presses Ctrl+C, restarting a server that stops on its own.
        while True:
            for index, (server, process) in enumerate(processes):
                if process.poll() is None:
                    continue
                if restarts[server.name] >= MAX_RESTARTS:
                    say(f"{RED}{server.label} keeps stopping (exit code {process.returncode}); giving up.{RESET}")
                    return 1
                restarts[server.name] += 1
                say(
                    f"{YELLOW}{server.label} stopped unexpectedly (exit code {process.returncode});"
                    f" restarting ({restarts[server.name]}/{MAX_RESTARTS}).{RESET}"
                )
                time.sleep(2)
                processes[index] = (server, start_server(commands[server.name], server))
            time.sleep(0.5)
    except KeyboardInterrupt:
        say(f"\n{DIM}Stopping servers...{RESET}")
        return 0
    finally:
        # The API last, so nothing is still forwarding registrations to it.
        for server, process in reversed(processes):
            stop(process, graceful=server is API)
        if processes:
            say(f"{DIM}Stopped.{RESET}")


if __name__ == "__main__":
    sys.exit(main())
