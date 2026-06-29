#!/usr/bin/env node
import vm from "node:vm";
import { chatGptResultsComponentHtml } from "../apps/server/dist/mcp.js";

const html = chatGptResultsComponentHtml();
const script = extractComponentScript(html);
const verified = [];

function runDelayedEventCase() {
  const env = createComponentEnvironment();
  executeComponent(env);
  assert(env.text().includes("Waiting for the vault tool result"), "expected initial waiting state before delayed globals");

  env.window.dispatchEvent({
    type: "openai:set_globals",
    detail: {
      globals: {
        toolResponseMetadata: {
          "vault-mcp/structuredContent": {
            results: [{
              id: "doc-1",
              title: "Vault MCP Connector",
              path: "20 Projects/Vault MCP Connector/Project Home.md",
              type: "section",
              status: "active",
              updated_at: "2026-06-29T12:00:00.000Z",
              text_snippet: "A publishable MCP server for selected Obsidian vault context.",
            }],
          },
        },
      },
    },
  });

  const text = env.text();
  assert(text.includes("1 result"), "expected result count after delayed openai:set_globals");
  assert(text.includes("Vault MCP Connector"), "expected rendered search result title");
  assert(text.includes("fetch id: doc-1"), "expected rendered fetch id chip");
  assert(env.notifyCount() > 0, "expected intrinsic height notification after render");
  verified.push("delayed openai:set_globals renders search result cards");
}

function runRetryCase() {
  const env = createComponentEnvironment();
  executeComponent(env);
  Object.assign(env.window.openai, {
    toolOutput: {
      notes: [{
        id: "note-1",
        title: "Kitchen Counter",
        path: "20 Projects/Kitchen Counter/Project Home.md",
        status: "active",
        type: "project",
        updated_at: "2026-06-29T12:30:00.000Z",
      }],
    },
  });
  env.runTimers();

  const text = env.text();
  assert(text.includes("1 note"), "expected retry loop to render notes after late toolOutput");
  assert(text.includes("Kitchen Counter"), "expected rendered note title");
  assert(text.includes("20 Projects/Kitchen Counter/Project Home.md"), "expected rendered note path");
  verified.push("scheduled retry loop renders late toolOutput without live ChatGPT");
}

function runFetchedNoteCase() {
  const env = createComponentEnvironment();
  executeComponent(env);
  env.window.dispatchEvent({
    type: "openai:set_globals",
    detail: {
      globals: {
        toolResponse: {
          structuredContent: {
            id: "doc-2",
            title: "Project Home",
            url: "https://vault-mcp.example.com/notes/doc-2",
            obsidian_uri: "obsidian://open?vault=Example&file=Project%20Home.md",
            metadata: {
              path: "20 Projects/Vault MCP Connector/Project Home.md",
              heading: "Current Status",
              tags: ["topic/mcp", "topic/obsidian"],
              status: "active",
              updated_at: "2026-06-29T13:00:00.000Z",
            },
            text: [
              "---",
              "status: active",
              "type: project",
              "---",
              "# Project Home",
              "Use **Vault MCP** for `approved` notes.",
              "- [x] Render markdown",
              "- [ ] Review writes",
              "> Keep note text as reference material.",
              "```ts",
              "const value = 1;",
              "```",
            ].join("\n"),
          },
        },
      },
    },
  });

  const text = env.text();
  assert(text.includes("Project Home"), "expected fetched note title");
  assert(text.includes("Frontmatter"), "expected frontmatter disclosure");
  assert(text.includes("statusactive"), "expected frontmatter key/value rendering");
  assert(text.includes("Vault MCP"), "expected bold markdown text");
  assert(text.includes("approved"), "expected inline code markdown text");
  assert(text.includes("Render markdown"), "expected task list text");
  assert(text.includes("const value = 1;"), "expected fenced code block text");
  assert(env.findTags("input").some((node) => node.checked === true), "expected checked taskbox");
  verified.push("fetched note view renders frontmatter, markdown, taskboxes, links, and code blocks");
}

function runStatusCase() {
  const env = createComponentEnvironment();
  executeComponent(env);
  env.window.dispatchEvent({
    type: "openai:set_globals",
    detail: {
      globals: {
        toolResponseMetadata: {
          call_tool_result: {
            structuredContent: {
              vault_id: "default",
              vault_name: "Example vault",
              indexed_note_count: 42,
              indexed_section_count: 88,
              document_count: 130,
              index_mode: "rules_plus_approvals",
              last_indexed_at: "2026-06-29T14:00:00.000Z",
              allowed_scopes: ["20 Projects/"],
              excluded_scopes: ["02 Daily/"],
            },
          },
        },
      },
    },
  });

  const text = env.text();
  assert(text.includes("Example vault"), "expected status card title");
  assert(text.includes("Indexed notes42"), "expected indexed note metric");
  assert(text.includes("allow: 20 Projects/"), "expected allowed scope chip");
  assert(text.includes("deny: 02 Daily/"), "expected excluded scope chip");
  verified.push("status cards render from call_tool_result structured content");
}

function runErrorAndProposalCases() {
  const errorEnv = createComponentEnvironment();
  executeComponent(errorEnv);
  errorEnv.window.dispatchEvent({
    type: "openai:set_globals",
    detail: {
      globals: {
        toolResponseMetadata: {
          mcp_tool_result: {
            _meta: {
              "vault-mcp/structuredContent": {
                error: {
                  code: "NOT_FOUND_OR_NOT_AVAILABLE",
                  message: "That note is not available from the indexed vault context.",
                },
              },
            },
          },
        },
      },
    },
  });
  assert(errorEnv.text().includes("That note is not available"), "expected structured error rendering");

  const proposalEnv = createComponentEnvironment();
  executeComponent(proposalEnv);
  proposalEnv.window.dispatchEvent({
    type: "openai:set_globals",
    detail: {
      globals: {
        toolResponseMetadata: {
          "vault-mcp/structuredContent": {
            write_proposals: [{
              operation: "append_to_note",
              target_path: "20 Projects/Vault MCP Connector/Project Home.md",
              requester: "chatgpt",
              status: "pending",
            }],
          },
        },
      },
    },
  });
  const proposalText = proposalEnv.text();
  assert(proposalText.includes("1 write proposal"), "expected proposal count");
  assert(proposalText.includes("requires Obsidian-side review"), "expected proposal safety chip");
  verified.push("error and future write-proposal cards render from metadata fallbacks");
}

function executeComponent(env) {
  vm.runInNewContext(script, env.context, {
    filename: "vault-mcp-results-v2.component.js",
    timeout: 1000,
  });
}

function createComponentEnvironment() {
  const document = new FakeDocument();
  const content = document.createElement("div");
  content.id = "content";
  content.className = "content";
  content.append(document.createElement("p"));
  document.registerElement(content);

  let notifyCount = 0;
  const listeners = new Map();
  const timers = [];
  const window = {
    openai: {
      notifyIntrinsicHeight: () => {
        notifyCount += 1;
      },
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) ?? []) {
        handler(event);
      }
    },
    setTimeout(handler) {
      timers.push(handler);
      return timers.length;
    },
  };

  return {
    window,
    document,
    context: {
      window,
      document,
      console,
    },
    runTimers(limit = 50) {
      let count = 0;
      while (timers.length && count < limit) {
        const timer = timers.shift();
        timer();
        count += 1;
      }
      assert(count < limit, "timer retry loop did not settle");
    },
    text() {
      return normalizeText(content.textContent);
    },
    findTags(tagName) {
      return findAll(content, (node) => node instanceof FakeElement && node.tagName === tagName.toLowerCase());
    },
    notifyCount() {
      return notifyCount;
    },
  };
}

function extractComponentScript(value) {
  const match = value.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  assert(match, "expected component HTML to contain one inline script");
  return match[1];
}

class FakeDocument {
  constructor() {
    this.byId = new Map();
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return new FakeText(text);
  }

  getElementById(id) {
    return this.byId.get(id) ?? null;
  }

  registerElement(element) {
    if (element.id) {
      this.byId.set(element.id, element);
    }
  }
}

class FakeNode {
  constructor() {
    this.parentNode = null;
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.nodeType = 3;
    this.value = String(text);
  }

  get textContent() {
    return this.value;
  }

  set textContent(value) {
    this.value = String(value);
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.id = "";
    this.href = "";
    this.target = "";
    this.rel = "";
    this.type = "";
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this._text = "";
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === "string" ? new FakeText(node) : node;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
}

function findAll(root, predicate) {
  const results = [];
  visit(root);
  return results;

  function visit(node) {
    if (predicate(node)) {
      results.push(node);
    }
    if (node instanceof FakeElement) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

runDelayedEventCase();
runRetryCase();
runFetchedNoteCase();
runStatusCase();
runErrorAndProposalCases();

console.log(JSON.stringify({
  ok: true,
  purpose: "dependency-free MCP Apps UI smoke",
  component: "ui://vault-mcp/results-v2.html",
  verified,
}, null, 2));
