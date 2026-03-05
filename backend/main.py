import os, json, csv, io, asyncio
import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
MODEL = "google/gemma-3-4b-it:free"

client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
) if OPENROUTER_API_KEY else None

app = FastAPI(title="Ticket Classifier API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class TicketResult(BaseModel):
    id: str
    subject: str
    body: str
    category: str
    priority: str
    sentiment: str
    confidence: float
    summary: str
    tags: list[str]

class ClassifyResponse(BaseModel):
    tickets: list[TicketResult]
    total: int

class IntegrationTicket(BaseModel):
    id: str
    subject: str
    body: str
    source: str
    source_url: str = ""

CLASSIFY_PROMPT = """You are a support ticket classifier. Respond with ONLY a JSON object, no markdown, no explanation.

{{
  "category": "<one of: billing, technical, account, feature_request, bug, general>",
  "priority": "<one of: critical, high, medium, low>",
  "sentiment": "<one of: positive, neutral, negative>",
  "confidence": <float 0-1>,
  "summary": "<one sentence>",
  "tags": ["<2-4 tags>"]
}}

Priority: critical=outage/security/data-loss, high=broken-feature/billing-error, medium=minor-bug/question, low=feature-request/feedback

Subject: {subject}
Body: {body}

JSON only:"""

def find_col(cols, options):
    for o in options:
        for c in cols:
            if c.strip().lower() == o.lower():
                return c
    return None

async def classify_ticket(ticket_id: str, subject: str, body: str, retries: int = 3) -> TicketResult:
    for attempt in range(retries):
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": CLASSIFY_PROMPT.format(subject=subject, body=body[:800])}],
                max_tokens=200,
                temperature=0.1,
            )
            raw = response.choices[0].message.content.strip().strip("```json").strip("```").strip()
            data = json.loads(raw)
            return TicketResult(
                id=ticket_id, subject=subject, body=body,
                category=data.get("category", "general"),
                priority=data.get("priority", "medium"),
                sentiment=data.get("sentiment", "neutral"),
                confidence=float(data.get("confidence", 0.8)),
                summary=data.get("summary", subject),
                tags=data.get("tags", []),
            )
        except Exception as e:
            err = str(e)
            is_rate_limit = "429" in err
            is_last = attempt == retries - 1
            if is_rate_limit and not is_last:
                await asyncio.sleep(15 * (attempt + 1))
                continue
            return TicketResult(
                id=ticket_id, subject=subject, body=body,
                category="general", priority="medium", sentiment="neutral",
                confidence=0.0,
                summary=f"{'Classification pending — please retry' if is_rate_limit else f'Error: {e}'}",
                tags=[],
            )

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL}

# ─── CSV endpoints ────────────────────────────────────────────────────────────

@app.post("/classify/stream")
async def classify_stream(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files supported.")
    if not client:
        raise HTTPException(500, "OPENROUTER_API_KEY not configured.")
    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "CSV is empty.")
    cols = list(rows[0].keys())
    id_col = find_col(cols, ["id", "ticket id", "ticket_id"]) or cols[0]
    subject_col = find_col(cols, ["subject", "ticket subject", "ticket_subject", "title"])
    body_col = find_col(cols, ["body", "description", "ticket description", "ticket_description", "message", "text"])
    if not subject_col or not body_col:
        raise HTTPException(400, f"Could not detect columns. Found: {cols}")

    async def event_stream():
        total = len(rows)
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"
        for i, row in enumerate(rows):
            subject = row.get(subject_col, "").strip()
            body = row.get(body_col, "").strip()
            ticket_id = str(row.get(id_col, i + 1)).strip()
            yield f"data: {json.dumps({'type': 'progress', 'current': i+1, 'total': total, 'subject': subject})}\n\n"
            result = await classify_ticket(ticket_id, subject, body)
            yield f"data: {json.dumps({'type': 'ticket', 'ticket': result.model_dump()})}\n\n"
            if i < total - 1:
                await asyncio.sleep(10)
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

# ─── GitHub Integration ───────────────────────────────────────────────────────

@app.get("/integrations/github/import")
async def github_import(token: str, repo: str, state: str = "open", limit: int = 20):
    headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
    url = f"https://api.github.com/repos/{repo}/issues?state={state}&per_page={limit}"
    async with httpx.AsyncClient() as h:
        r = await h.get(url, headers=headers)
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"GitHub error: {r.text}")
    issues = r.json()
    return [IntegrationTicket(
        id=str(i["number"]),
        subject=i["title"],
        body=i.get("body") or "",
        source="github",
        source_url=i["html_url"],
    ) for i in issues if "pull_request" not in i]

@app.post("/integrations/github/writeback")
async def github_writeback(token: str, repo: str, tickets: list[TicketResult]):
    headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
    results = []
    async with httpx.AsyncClient() as h:
        for t in tickets:
            # Add comment with classification
            comment = f"🤖 **TicketAI Classification**\n\n| Field | Value |\n|---|---|\n| **Category** | {t.category} |\n| **Priority** | {t.priority} |\n| **Sentiment** | {t.sentiment} |\n| **Confidence** | {int(t.confidence*100)}% |\n\n**Summary:** {t.summary}\n\n**Tags:** {', '.join(t.tags)}"
            r = await h.post(
                f"https://api.github.com/repos/{repo}/issues/{t.id}/comments",
                headers=headers,
                json={"body": comment}
            )
            # Add priority label
            label_color = {"critical": "d73a4a", "high": "e4a000", "medium": "fbca04", "low": "0e8a16"}.get(t.priority, "cccccc")
            await h.post(f"https://api.github.com/repos/{repo}/labels", headers=headers,
                json={"name": f"priority:{t.priority}", "color": label_color})
            await h.post(f"https://api.github.com/repos/{repo}/issues/{t.id}/labels",
                headers=headers, json={"labels": [f"priority:{t.priority}", t.category]})
            results.append({"id": t.id, "status": "ok" if r.status_code in [200, 201] else "error"})
    return {"written": len(results), "results": results}

# ─── Freshdesk Integration ────────────────────────────────────────────────────

@app.get("/integrations/freshdesk/import")
async def freshdesk_import(domain: str, api_key: str, limit: int = 20):
    url = f"https://{domain}.freshdesk.com/api/v2/tickets?per_page={limit}&order_type=asc"
    async with httpx.AsyncClient() as h:
        r = await h.get(url, auth=(api_key, "X"))
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Freshdesk error: {r.text}")
    tickets = r.json()
    return [IntegrationTicket(
        id=str(t["id"]),
        subject=t.get("subject", ""),
        body=t.get("description_text", t.get("description", "")),
        source="freshdesk",
        source_url=f"https://{domain}.freshdesk.com/a/tickets/{t['id']}",
    ) for t in tickets]

@app.post("/integrations/freshdesk/writeback")
async def freshdesk_writeback(domain: str, api_key: str, tickets: list[TicketResult]):
    priority_map = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    results = []
    async with httpx.AsyncClient() as h:
        for t in tickets:
            # Update priority
            r = await h.put(
                f"https://{domain}.freshdesk.com/api/v2/tickets/{t.id}",
                auth=(api_key, "X"),
                json={"priority": priority_map.get(t.priority, 2)}
            )
            # Add private note
            note = f"🤖 TicketAI: {t.category} | {t.priority} | {t.sentiment} ({int(t.confidence*100)}%)\n\n{t.summary}\n\nTags: {', '.join(t.tags)}"
            await h.post(
                f"https://{domain}.freshdesk.com/api/v2/tickets/{t.id}/notes",
                auth=(api_key, "X"),
                json={"body": f"<p>{note}</p>", "private": True}
            )
            results.append({"id": t.id, "status": "ok" if r.status_code == 200 else "error"})
    return {"written": len(results), "results": results}

# ─── Linear Integration ───────────────────────────────────────────────────────

@app.get("/integrations/linear/import")
async def linear_import(api_key: str, limit: int = 20):
    query = """query { issues(first: %d, filter: { state: { type: { in: ["unstarted", "started"] } } }) { nodes { id title description url } } }""" % limit
    async with httpx.AsyncClient() as h:
        r = await h.post("https://api.linear.app/graphql",
            headers={"Authorization": api_key, "Content-Type": "application/json"},
            json={"query": query})
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Linear error: {r.text}")
    issues = r.json().get("data", {}).get("issues", {}).get("nodes", [])
    return [IntegrationTicket(
        id=i["id"], subject=i["title"],
        body=i.get("description") or "",
        source="linear", source_url=i.get("url", ""),
    ) for i in issues]

@app.post("/integrations/linear/writeback")
async def linear_writeback(api_key: str, tickets: list[TicketResult]):
    priority_map = {"critical": 1, "high": 2, "medium": 3, "low": 4}
    results = []
    async with httpx.AsyncClient() as h:
        for t in tickets:
            mutation = """mutation { issueUpdate(id: "%s", input: { priority: %d }) { success } }""" % (t.id, priority_map.get(t.priority, 3))
            r = await h.post("https://api.linear.app/graphql",
                headers={"Authorization": api_key, "Content-Type": "application/json"},
                json={"query": mutation})
            comment_body = f"TicketAI: {t.category} | {t.priority} | {t.sentiment} ({int(t.confidence*100)}%)\n\n{t.summary}\n\nTags: {', '.join(t.tags)}"
            await h.post("https://api.linear.app/graphql",
                headers={"Authorization": api_key, "Content-Type": "application/json"},
                json={"query": "mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }", "variables": {"issueId": t.id, "body": comment_body}})
            results.append({"id": t.id, "status": "ok" if r.status_code == 200 else "error"})
    return {"written": len(results), "results": results}

# ─── Notion Integration ───────────────────────────────────────────────────────

@app.get("/integrations/notion/import")
async def notion_import(api_key: str, database_id: str, limit: int = 20):
    headers = {"Authorization": f"Bearer {api_key}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
    async with httpx.AsyncClient() as h:
        r = await h.post(f"https://api.notion.com/v1/databases/{database_id}/query",
            headers=headers, json={"page_size": limit})
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Notion error: {r.text}")
    pages = r.json().get("results", [])
    tickets = []
    for p in pages:
        props = p.get("properties", {})
        title_prop = next((v for v in props.values() if v.get("type") == "title"), None)
        subject = "".join(t["plain_text"] for t in (title_prop or {}).get("title", [])) if title_prop else "Untitled"
        body_prop = props.get("Description") or props.get("Body") or props.get("Content")
        body = ""
        if body_prop and body_prop.get("type") == "rich_text":
            body = "".join(t["plain_text"] for t in body_prop.get("rich_text", []))
        tickets.append(IntegrationTicket(
            id=p["id"], subject=subject, body=body,
            source="notion", source_url=p.get("url", ""),
        ))
    return tickets

@app.post("/integrations/notion/writeback")
async def notion_writeback(api_key: str, tickets: list[TicketResult]):
    headers = {"Authorization": f"Bearer {api_key}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
    results = []
    async with httpx.AsyncClient() as h:
        for t in tickets:
            r = await h.patch(f"https://api.notion.com/v1/pages/{t.id}",
                headers=headers,
                json={"properties": {
                    "Priority": {"select": {"name": t.priority.capitalize()}},
                    "Category": {"select": {"name": t.category.replace("_", " ").capitalize()}},
                    "AI Summary": {"rich_text": [{"type": "text", "text": {"content": t.summary[:2000]}}]},
                }})
            results.append({"id": t.id, "status": "ok" if r.status_code == 200 else "error"})
    return {"written": len(results), "results": results}
