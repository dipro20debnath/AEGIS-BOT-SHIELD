"""Researcher commands (run on the server; there is no admin web page).

    python -m aegis_study codes --kind human --count 40          # study codes for participants
    python -m aegis_study codes --kind bot --tool playwright-human --count 20 --config '{"speed": 1.0}'
    python -m aegis_study stats
    python -m aegis_study check                                  # ready for participants?
    python -m aegis_study export --out dataset/
    python -m aegis_study withdraw H-ABCD2345                    # delete everything of one code
    python -m aegis_study backup --out study-backup.db

Environment: STUDY_DB (default study.db), AEGIS_SECRET_KEY (needed by export).
"""
import argparse
import json
import os
import sys

from . import i18n
from .config import StudyConfig
from .db import Database, normalize_code


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m aegis_study", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("codes", help="create study codes")
    p.add_argument("--kind", choices=["human", "bot"], required=True)
    p.add_argument("--count", type=int, default=1)
    p.add_argument("--tool", help="bot tool name (bots only), e.g. playwright-human")
    p.add_argument("--config", help="bot configuration as JSON (bots only)")
    sub.add_parser("stats", help="counts so far")
    sub.add_parser("check", help="check the setup before inviting participants")
    p = sub.add_parser("export", help="write the dataset")
    p.add_argument("--out", required=True)
    p.add_argument("--no-parquet", action="store_true")
    p = sub.add_parser("withdraw", help="delete all data of a study code")
    p.add_argument("code")
    p.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    p = sub.add_parser("backup", help="consistent copy of the database")
    p.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    config = StudyConfig.from_env()
    db = Database(config.db_path)
    if args.command == "codes":
        bot_config = json.loads(args.config) if args.config else None
        for code in db.create_codes(args.kind, args.count, args.tool, bot_config):
            print(code)
    elif args.command == "stats":
        print(json.dumps(db.stats(), indent=2))
    elif args.command == "check":
        return check(config, db)
    elif args.command == "export":
        if len(config.secret_key) < 16:
            print("AEGIS_SECRET_KEY is needed (it salts the participant ids)", file=sys.stderr)
            return 2
        from .export import export
        manifest = export(db, args.out, config.secret_key, parquet=not args.no_parquet)
        print(json.dumps({k: manifest[k] for k in ("rows", "raw", "labels")}, indent=2))
    elif args.command == "withdraw":
        code = normalize_code(args.code)
        if db.get_code(code) is None:
            print(f"unknown code {code}", file=sys.stderr)
            return 1
        if not args.yes and input(f"Delete all data of {code}? Type yes: ").strip() != "yes":
            return 1
        sessions, rows = db.withdraw(code)
        print(f"deleted {sessions} session(s), {rows} row(s) and the code {code}")
        print("Also delete this code from any exported copies of the dataset.")
    elif args.command == "backup":
        db.backup(args.out)
        print(f"backup written to {args.out}")
    return 0


def check(config: StudyConfig, db: Database) -> int:
    problems = []
    if len(config.secret_key) < 16:
        problems.append("AEGIS_SECRET_KEY missing or shorter than 16 characters")
    if not os.path.isfile(os.path.join(config.sdk_dir, "aegis.min.js")):
        problems.append(f"SDK bundle not found in {config.sdk_dir} (npm run build)")
    if config.ml_model_path and not os.path.isfile(config.ml_model_path):
        problems.append(f"ML model not found: {config.ml_model_path}")
    for lang in i18n.LANGS:
        if i18n.consent_html(lang)["draft"]:
            problems.append(f"consent_{lang}.md still has [placeholders]: fill them in before inviting people")
    if not config.secure_cookies:
        problems.append("STUDY_SECURE_COOKIES is off: set it when the site is served over HTTPS")
    print(json.dumps(db.stats(), indent=2))
    for problem in problems:
        print("PROBLEM:", problem)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
