import asyncio
import os
import sys

from dotenv import load_dotenv

from agents import Agent, Runner, ModelSettings, set_default_openai_key
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX
from agents.mcp import MCPServerStdio


DEFAULT_TASK = """
Goal: Build a simple web app.
Requirements:
- Single-page app that lets me add/edit/delete notes.
- Notes persist locally (localStorage).
- Basic search filter.
Constraints:
- Beginner-friendly code, no frameworks.
Deliverables:
- index.html, styles.css, app.js
- README.md with how to run
- A tiny manual test checklist in TEST.md
""".strip()


def _env(name: str, default: str = "") -> str:
    v = os.getenv(name)
    return (v if v is not None else default).strip()


def _env_int(name: str, default: int) -> int:
    v = _env(name, "")
    return default if not v else int(v)


def npx_command() -> str:
    return "npx.cmd" if os.name == "nt" else "npx"


def require_api_key() -> None:
    key = _env("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("Missing OPENAI_API_KEY in .env")
    set_default_openai_key(key)


def agent_model_settings() -> ModelSettings:
    # GPT-5 reasoning models don't support temperature unless reasoning.effort == "none".
    # (Your error came from sending temperature while using a reasoning effort.) 
    effort = _env("AGENTS_REASONING", "medium").lower()

    ms = ModelSettings(
        # Use a plain dict to avoid extra imports; Agents SDK passes it through.
        reasoning={"effort": effort},
    )

    if effort == "none":
        t = _env("AGENTS_TEMPERATURE", "")
        if t:
            ms.temperature = float(t)

    return ms


async def main() -> None:
    load_dotenv(override=True)
    require_api_key()

    task = " ".join(sys.argv[1:]).strip() or DEFAULT_TASK
    max_turns = _env_int("WORKFLOW_MAX_TURNS", 30)

    codex_model = _env("CODEX_MODEL", "gpt-5.3-codex")
    codex_sandbox = _env("CODEX_SANDBOX", "workspace-write")
    codex_approval = _env("CODEX_APPROVAL", "never")

    # Start Codex as MCP tool server. Model/permissions are set via flags here.
    async with MCPServerStdio(
        name="Codex CLI",
        params={
            "command": npx_command(),
            "args": [
                "-y", "codex", "mcp-server",
                "--model", codex_model,
                "--sandbox", codex_sandbox,
                "--ask-for-approval", codex_approval,
                "--cd", ".",
            ],
        },
        client_session_timeout_seconds=360000,
    ) as codex_mcp:

        agents_model = _env("AGENTS_MODEL", "gpt-5.2-codex")
        ms = agent_model_settings()

        engineer = Agent(
            name="Engineer Agent",
            model=agents_model,
            model_settings=ms,
            instructions=(
                f"{RECOMMENDED_PROMPT_PREFIX}\n"
                "You are the Engineer.\n"
                "Source of truth: REQUIREMENTS.md, TASKS.md, TEST.md.\n"
                "Implement ONLY what is in TASKS.md.\n"
                "Use Codex MCP for ALL file edits.\n"
                "Update TASKS.md as you complete items.\n"
                "When done, hand off using transfer_to_pm_agent.\n"
            ),
            mcp_servers=[codex_mcp],
        )

        pm = Agent(
            name="PM Agent",
            model=agents_model,
            model_settings=ms,
            instructions=(
                f"{RECOMMENDED_PROMPT_PREFIX}\n"
                "You are the Product Manager.\n"
                "Create/update these files in the project root:\n"
                "- REQUIREMENTS.md\n"
                "- TASKS.md (ordered checklist with acceptance criteria)\n"
                "- TEST.md (manual checks)\n"
                "Use Codex MCP for ALL file edits.\n"
                "Then hand off using transfer_to_engineer_agent.\n"
                "After Engineer returns, verify acceptance criteria; if missing, hand back with a fix list.\n"
            ),
            handoffs=[engineer],
            mcp_servers=[codex_mcp],
        )

        engineer.handoffs = [pm]

        result = await Runner.run(pm, task, max_turns=max_turns)
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main())
