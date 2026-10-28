#!/usr/bin/env python3
"""Export PostgreSQL snapshot, run checks query, and dump database with age encryption."""

import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 9:
        sys.stderr.write(
            "Usage: dump-snapshot.py <container> <db> <win_start> <win_end> "
            "<checks_sql_file> <recipients_file> <dump_file> <meta_file>\n"
        )
        return 2

    pg_container = sys.argv[1]
    pg_db = sys.argv[2]
    win_start = sys.argv[3]
    win_end = sys.argv[4]
    checks_sql_file = sys.argv[5]
    recipients_file = sys.argv[6]
    dump_file = sys.argv[7]
    meta_file = sys.argv[8]

    with open(checks_sql_file, "r", encoding="utf-8") as f:
        checks_sql = f.read()

    psql_cmd = [
        "docker",
        "exec",
        "-i",
        "-u",
        "postgres",
        pg_container,
        "psql",
        "-U",
        "backup",
        "-d",
        pg_db,
        "-X",
        "-q",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
    ]

    psql = subprocess.Popen(
        psql_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if psql.stdin is None or psql.stdout is None:
        sys.stderr.write("Failed to initialize pipes for psql\n")
        return 3

    psql.stdin.write(
        "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;\n"
        "SELECT pg_export_snapshot();\n"
    )
    psql.stdin.flush()

    snapshot = psql.stdout.readline().strip()
    if not snapshot:
        stderr_err = psql.stderr.read() if psql.stderr else ""
        sys.stderr.write(f"Failed to export database snapshot: {stderr_err}\n")
        psql.kill()
        return 3

    psql.stdin.write(f"\\set win_start {win_start}\n\\set win_end {win_end}\n")
    psql.stdin.write(checks_sql + "\n")
    psql.stdin.flush()

    checks_json = psql.stdout.readline().strip()
    if not checks_json:
        stderr_err = psql.stderr.read() if psql.stderr else ""
        sys.stderr.write(f"Failed to obtain checks json: {stderr_err}\n")
        psql.kill()
        return 3

    dump_cmd = [
        "docker",
        "exec",
        "-u",
        "postgres",
        pg_container,
        "pg_dump",
        "-U",
        "backup",
        "-d",
        pg_db,
        "--format=custom",
        "--compress=zstd:level=6",
        f"--snapshot={snapshot}",
        "--lock-wait-timeout=120s",
        "--no-password",
    ]
    age_cmd = ["age", "-R", recipients_file]

    with open(dump_file, "wb") as out_f:
        p_dump = subprocess.Popen(dump_cmd, stdout=subprocess.PIPE)
        p_age = subprocess.Popen(age_cmd, stdin=p_dump.stdout, stdout=out_f)
        if p_dump.stdout:
            p_dump.stdout.close()
        p_age.communicate()
        p_dump.wait()

        if p_dump.returncode != 0 or p_age.returncode != 0:
            sys.stderr.write(
                f"pg_dump (exit {p_dump.returncode}) or age (exit {p_age.returncode}) failed\n"
            )
            psql.kill()
            return 3

    psql.stdin.write("COMMIT;\n\\q\n")
    psql.stdin.flush()
    psql.stdin.close()
    psql.wait()

    with open(meta_file, "w", encoding="utf-8") as f:
        f.write(f"{snapshot}\n{checks_json}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
