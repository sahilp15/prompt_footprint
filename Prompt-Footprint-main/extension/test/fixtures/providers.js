// Saved DOM fixtures for provider model detection.
// ---------------------------------------------------------------------------
// Each fixture is a page shaped like the real product at one moment: menu open,
// menu closed, Auto selected, a custom GPT / Gem / Project, tool chips on, and
// a label from a model that does not exist yet.
//
// The decoys matter as much as the real controls. Every fixture deliberately
// carries extra model-shaped strings — a closed menu still in the DOM, a
// <template> clone, a settings row, a conversation title — because a detector
// that only ever sees the happy path is a detector that will pick the wrong
// string the first time a real page renders one.

const CHATGPT_MENU_CLOSED = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button" aria-haspopup="menu" aria-expanded="false">GPT-5.6 Sol</button>
    <h1 class="conversation-title">Migrating from Claude Opus 5 to Gemini</h1>
  </div>
  <div role="menu" data-state="closed">
    <div role="menuitemradio" aria-checked="false">GPT-5.6 Terra</div>
    <div role="menuitemradio" aria-checked="false">GPT-5.6 Luna</div>
  </div>
  <template><div role="menuitemradio" aria-checked="true">GPT-5.6 Luna</div></template>
  <main>
    <form data-type="unified-composer">
      <div id="composer-background">
        <div contenteditable="true" id="prompt-textarea" data-lexical-editor="true"></div>
        <button data-testid="send-button" aria-label="Send prompt"></button>
      </div>
    </form>
  </main>
  <div hidden><button aria-label="Delete chat">GPT-5.6 Sol</button></div>
</body></html>`;

const CHATGPT_MENU_OPEN = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button" aria-haspopup="menu" aria-expanded="true">GPT-5.6 Terra</button>
  </div>
  <div role="menu" data-state="open">
    <div role="menuitemradio" aria-checked="false">GPT-5.6 Terra</div>
    <div role="menuitemradio" aria-checked="true">GPT-5.6 Luna</div>
    <div role="menuitemradio" aria-checked="false">Auto</div>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

const CHATGPT_AUTO = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button" aria-label="Model selector">Auto</button>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

const CHATGPT_UNKNOWN_LABEL = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button">GPT-7.2 Nimbus</button>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

const CHATGPT_CUSTOM_GPT = `<!doctype html><html><body>
  <div id="page-header">
    <h1 class="conversation-title">Opus Editor Pro</h1>
    <button data-testid="model-switcher-dropdown-button" aria-label="Model selector">Auto</button>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

const CHATGPT_TOOLS = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button">GPT-5.6 Sol</button>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
    <button aria-pressed="true" aria-label="Deep research">Deep research</button>
    <button aria-pressed="false" aria-label="Create image">Image</button>
    <button aria-pressed="true" aria-label="Search the web">Search</button>
  </form></main>
</body></html>`;

const CLAUDE_PICKER = `<!doctype html><html><body>
  <header>
    <button data-testid="model-selector-dropdown" aria-haspopup="menu">Claude Opus 5</button>
  </header>
  <main><div class="chat"><div data-testid="user-message">hello</div></div></main>
  <fieldset>
    <div contenteditable="true" class="ProseMirror"></div>
    <button data-testid="effort-selector" aria-label="Effort: high">High</button>
    <button aria-pressed="true" aria-label="Research">Research</button>
    <button aria-label="Send message"></button>
  </fieldset>
</body></html>`;

const CLAUDE_MENU_OPEN = `<!doctype html><html><body>
  <header><button data-testid="model-selector-dropdown">Claude Sonnet 5</button></header>
  <div role="menu" data-state="open">
    <div role="menuitem" aria-selected="false">Claude Sonnet 5</div>
    <div role="menuitem" aria-selected="true">Claude Fable 5</div>
    <div role="menuitem" aria-selected="false">Claude Mythos 5</div>
    <div role="menuitem" aria-selected="false">Claude Opus 5</div>
  </div>
  <fieldset><div contenteditable="true" class="ProseMirror"></div></fieldset>
</body></html>`;

const CLAUDE_PROJECT = `<!doctype html><html><body>
  <header>
    <h1>Fable 5 migration project</h1>
    <span class="project-style">Style: Opus 5 formal</span>
  </header>
  <fieldset><div contenteditable="true" class="ProseMirror"></div></fieldset>
</body></html>`;

const GEMINI_COMPOSER = `<!doctype html><html><body>
  <main>
    <div class="input-area">
      <rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea>
      <button data-test-id="bard-mode-menu-button" aria-label="Switch model">Gemini 3.6 Flash</button>
      <toolbox-drawer>
        <button aria-pressed="true" aria-label="Deep Research">Deep Research</button>
        <button aria-pressed="false" aria-label="Canvas">Canvas</button>
      </toolbox-drawer>
    </div>
  </main>
</body></html>`;

const GEMINI_MENU_OPEN = `<!doctype html><html><body>
  <main>
    <div class="input-area">
      <rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea>
      <button data-test-id="bard-mode-menu-button">Gemini 3.6 Flash</button>
    </div>
    <div role="menu" data-state="open">
      <div role="menuitemradio" aria-checked="false">Gemini 3.6 Flash</div>
      <div role="menuitemradio" aria-checked="true">Gemini 3.1 Pro</div>
      <div role="menuitemradio" aria-checked="false">Deep Think</div>
    </div>
  </main>
</body></html>`;

const GEMINI_GEM = `<!doctype html><html><body>
  <main>
    <h1>Gemini 3.1 Pro Coding Coach</h1>
    <div class="input-area">
      <rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea>
    </div>
  </main>
</body></html>`;


// ── Reasoning / thinking controls ──────────────────────────────────────────
// The thinking setting is a SEPARATE control from the model, and every product
// puts it somewhere different. These fixtures pin the three shapes that matter:
// a composer-adjacent chip, a submenu row inside the open model picker, and a
// picker label that names a mode rather than a model.

const CHATGPT_THINKING_HIGH = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button">GPT-5.6 Sol</button>
    <button data-testid="reasoning-effort-button" aria-label="Reasoning effort">Thinking · High</button>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

const CHATGPT_INSTANT = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button">GPT-5.6 Luna</button>
    <button data-testid="reasoning-effort-button" aria-label="Thinking mode">Instant</button>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

// The effort submenu is open. The selected row is the answer; the model picker
// still shows the model, and neither may be read as the other.
const CHATGPT_EFFORT_MENU = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button">GPT-5.6 Terra</button>
  </div>
  <div role="menu" data-state="open">
    <div role="menuitemradio" aria-checked="false">Instant</div>
    <div role="menuitemradio" aria-checked="false">Thinking</div>
    <div role="menuitemradio" aria-checked="true">Max</div>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

const CHATGPT_PRO = `<!doctype html><html><body>
  <div id="page-header">
    <button data-testid="model-switcher-dropdown-button">GPT-5.6 Sol</button>
    <button data-testid="reasoning-effort-button" aria-label="Reasoning">Pro</button>
  </div>
  <main><form data-type="unified-composer">
    <div contenteditable="true" id="prompt-textarea"></div>
  </form></main>
</body></html>`;

const CLAUDE_EFFORT_LOW = `<!doctype html><html><body>
  <header><button data-testid="model-selector-dropdown">Claude Sonnet 5</button></header>
  <fieldset>
    <div contenteditable="true" class="ProseMirror"></div>
    <button data-testid="effort-selector" aria-label="Effort: low">Low</button>
  </fieldset>
</body></html>`;

const CLAUDE_FABLE_ADAPTIVE = `<!doctype html><html><body>
  <header><button data-testid="model-selector-dropdown">Claude Fable 5</button></header>
  <fieldset>
    <div contenteditable="true" class="ProseMirror"></div>
    <button data-testid="effort-selector" aria-label="Effort">Off</button>
  </fieldset>
</body></html>`;

const GEMINI_DEEP_THINK_MODE = `<!doctype html><html><body>
  <main>
    <div class="input-area">
      <rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea>
      <button data-test-id="bard-mode-menu-button">Gemini 3.1 Pro</button>
      <button data-test-id="thinking-toggle" aria-label="Deep Think">Deep Think</button>
    </div>
  </main>
</body></html>`;

module.exports = {
  CHATGPT_MENU_CLOSED,
  CHATGPT_MENU_OPEN,
  CHATGPT_AUTO,
  CHATGPT_UNKNOWN_LABEL,
  CHATGPT_CUSTOM_GPT,
  CHATGPT_TOOLS,
  CLAUDE_PICKER,
  CLAUDE_MENU_OPEN,
  CLAUDE_PROJECT,
  GEMINI_COMPOSER,
  GEMINI_MENU_OPEN,
  GEMINI_GEM,
  CHATGPT_THINKING_HIGH,
  CHATGPT_INSTANT,
  CHATGPT_EFFORT_MENU,
  CHATGPT_PRO,
  CLAUDE_EFFORT_LOW,
  CLAUDE_FABLE_ADAPTIVE,
  GEMINI_DEEP_THINK_MODE,
};
