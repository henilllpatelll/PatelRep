"""``python -m services.agent_execution <command>`` -- the worker process and its operator runbook commands.

  worker                       run the worker (default). Exits 0 immediately unless enabled AND non-production.
  diagnostics                  print the sanitized operations view (state counts, leases, queue, dead letters, workers)
  recover                      run one bounded recovery sweep
  control  --scope ... [...]   set/clear a platform, hotel or agent pause, or the cost emergency stop
  run      --tenant T --run R --action cancel|pause|resume
  probe    --tenant T --operation noop|...   admit ONE synthetic run (non-production + synthetic opt-in only)

Commands use the backend service credentials from the environment. ``probe`` mints only the registered H0 system
principal ``harness.scheduled_observer``; it cannot create or impersonate a human or privileged identity.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import uuid
from datetime import datetime, timezone


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _store():
    from core.database import get_supabase
    from services.agent_execution.store import AgentRunStore

    return AgentRunStore(get_supabase())


def _new_store():
    from supabase import create_client

    from core.config import settings
    from core.database import _build_client_options
    from services.agent_execution.store import AgentRunStore

    return AgentRunStore(create_client(settings.supabase_project_url, settings.supabase_service_role_key,
                                       _build_client_options()))


def cmd_worker(_: argparse.Namespace) -> int:
    from services.agent_execution.config import WorkerSettings

    worker_settings = WorkerSettings()
    if not worker_settings.enabled:
        # Checked before the application settings load, so a disabled worker starts safely with incomplete config.
        print(json.dumps({"event": "worker_disabled", "reason": "not_enabled"}))
        return 0

    from core.config import settings  # enabled: incomplete or inconsistent configuration fails closed here
    from services.agent_execution.identity_authority import SupabaseIdentityAuthority
    from services.agent_execution.worker import Worker

    worker = Worker(worker_settings, app_env=settings.app_env, version=settings.release_sha,
                    store_factory=_new_store,  # one HTTP client per slot thread
                    authority_factory=lambda client: SupabaseIdentityAuthority(client, clock=_now))
    return worker.run()


def cmd_diagnostics(args: argparse.Namespace) -> int:
    print(json.dumps(_store().diagnostics(limit=args.limit), indent=2, sort_keys=True, default=str))
    return 0


def cmd_recover(args: argparse.Namespace) -> int:
    print(json.dumps(_store().recover(limit=args.limit), sort_keys=True))
    return 0


def cmd_control(args: argparse.Namespace) -> int:
    from services.agent_execution.controls_store import set_control

    row = set_control(_store().client, scope=args.scope, tenant_id=args.tenant, agent_id=args.agent,
                      paused=args.paused, cost_emergency_stop=args.cost_stop, updated_by=args.operator,
                      reason_code=args.reason)
    print(json.dumps(row, sort_keys=True, default=str))
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    from services.agent_execution.operations import operator_control

    print(json.dumps(operator_control(_store(), tenant_id=args.tenant, run_id=args.run, action=args.action,
                                      operator=args.operator), sort_keys=True))
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    from core.config import settings
    from services.agent_execution import SYNTHETIC_AGENT_ID, SYNTHETIC_AGENT_VERSION
    from services.agent_execution.admission import admit_synthetic_run
    from services.agent_execution.config import WorkerSettings
    from services.agent_execution.synthetic import SyntheticSpec
    from services.agent_harness.identity import context_for_system
    from services.agent_harness.vocabulary import TriggerType

    spec = SyntheticSpec(operation=args.operation, steps=args.steps, fail_times=args.fail_times, delay_ms=args.delay_ms)
    ctx = context_for_system("harness.scheduled_observer", hotel_id=args.tenant, agent_id=SYNTHETIC_AGENT_ID,
                             agent_version=SYNTHETIC_AGENT_VERSION, trigger=TriggerType.SCHEDULE, now=_now())
    result = admit_synthetic_run(_store(), ctx, spec, idempotency_key=args.key or f"probe-{uuid.uuid4().hex}",
                                 app_env=settings.app_env, synthetic_enabled=WorkerSettings().synthetic_enabled)
    print(json.dumps(result.__dict__, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m services.agent_execution")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("worker").set_defaults(func=cmd_worker)
    p = sub.add_parser("diagnostics")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_diagnostics)
    p = sub.add_parser("recover")
    p.add_argument("--limit", type=int, default=100)
    p.set_defaults(func=cmd_recover)
    p = sub.add_parser("control")
    p.add_argument("--scope", choices=["platform", "hotel", "agent"], required=True)
    p.add_argument("--tenant")
    p.add_argument("--agent")
    p.add_argument("--paused", action="store_true")
    p.add_argument("--cost-stop", action="store_true")
    p.add_argument("--operator", required=True)
    p.add_argument("--reason")
    p.set_defaults(func=cmd_control)
    p = sub.add_parser("run")
    p.add_argument("--tenant", required=True)
    p.add_argument("--run", required=True)
    p.add_argument("--action", choices=["cancel", "pause", "resume"], required=True)
    p.add_argument("--operator", required=True)
    p.set_defaults(func=cmd_run)
    p = sub.add_parser("probe")
    p.add_argument("--tenant", required=True)
    p.add_argument("--operation", choices=["noop", "transient_failure", "permanent_failure", "delay"], default="noop")
    p.add_argument("--steps", type=int, default=1)
    p.add_argument("--fail-times", type=int, default=0)
    p.add_argument("--delay-ms", type=int, default=0)
    p.add_argument("--key")
    p.set_defaults(func=cmd_probe)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = build_parser().parse_args(argv)
    if not getattr(args, "func", None):
        args = build_parser().parse_args(["worker"])
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
