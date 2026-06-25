# Klak Plan 1.2

**Status:** Product direction document  
**Date:** 25 June 2026  
**Purpose:** Preserve the product vision for turning Klak into a general-purpose AI computer operator.

---

## 1. Core vision

Klak should become a local AI operator that can use a computer the way a capable remote human operator would.

The user should be able to describe an outcome in natural language, then Klak should inspect the computer, plan the work, open applications, click, type, scroll, run commands, move files, use websites, verify results, recover from errors, and finish the task with minimal back-and-forth.

Klak is not limited to IT support. It should be able to perform any legitimate computer-based task that a trusted person could reasonably perform while sitting at the user's computer.

Examples include:

- Setting up and testing software
- Editing documents and spreadsheets
- Organizing files and folders
- Filling forms
- Researching and compiling reports
- Managing email and calendars
- Updating websites
- Using business systems
- Testing applications
- Preparing presentations
- Configuring accounts
- Uploading and downloading files
- Operating design, finance, support, productivity, and developer tools
- Repeating routine workflows
- Watching a process and responding when something changes

The product promise is:

> Tell Klak what outcome you want. Klak operates the computer, verifies the work, and asks only when approval, identity, judgment, or secret input is genuinely required.

---

## 2. What Klak is

Klak is a combination of:

- A natural-language assistant
- A local computer-control runtime
- A task planner
- A tool and application router
- A browser and desktop operator
- A workflow engine
- A verification system
- A local memory system
- A permission and safety layer
- An action audit trail

Klak should feel like a trusted operator working on the machine, not like a chatbot giving instructions.

---

## 3. What Klak is not

Klak should not be designed as only:

- An IT support assistant
- A chatbot that explains what the user should click
- A macro recorder
- A browser-only agent
- A coding-only assistant
- A remote desktop tool
- A collection of fixed scripts
- A system that blindly clicks based only on screenshots

Klak may use all of those techniques, but the complete product is broader: it understands goals and chooses the safest and most reliable way to complete them.

---

## 4. Example user requests

### General computer use

- "Clean up my Downloads folder and organize everything by type and project."
- "Find the PDF I downloaded yesterday and attach it to an email draft."
- "Rename these photos using the event date and sort them into folders."
- "Install this application, configure it, and make sure it starts correctly."
- "Update my profile information across these three websites."

### Office and administration

- "Take the figures from these invoices and update the monthly spreadsheet."
- "Prepare a weekly report from these documents and save it as PDF."
- "Compare these contracts and highlight the differences."
- "Schedule the meetings mentioned in this email thread."
- "Prepare a presentation using the notes in this folder."

### Business operations

- "Log into the dashboard, export yesterday's orders, and summarize failures."
- "Update product inventory from this spreadsheet."
- "Check which customer requests have not been answered."
- "Enter these approved records into the legacy desktop application."
- "Watch the support queue and alert me when a high-priority request arrives."

### Development and technical work

- "Clone this repository, configure it locally, run the tests, and fix setup errors."
- "Connect this local service to Chatwoot through ngrok and verify a test message."
- "Deploy the latest approved version to staging and run a smoke test."
- "Find why the server stopped and restore it without changing unrelated services."
- "Open the application and visually test the new checkout flow."

### Creative work

- "Resize these images for the website and update the product listings."
- "Prepare social-media drafts from this campaign document."
- "Open the design file, replace the outdated logo, and export the approved sizes."
- "Turn these notes into a formatted document."

### Personal productivity

- "Find suitable travel options and prepare a comparison."
- "Organize my study files by subject and create a revision schedule."
- "Collect all receipts from this month and place them into one folder."
- "Create a grocery list from this meal plan."

---

## 5. User experience

A task should normally follow this flow:

1. The user describes the desired outcome.
2. Klak restates the goal briefly and identifies important constraints.
3. Klak inspects the current computer state.
4. Klak creates an internal plan.
5. Klak requests approval only for consequential actions.
6. Klak performs the work.
7. Klak verifies each important result.
8. Klak retries or repairs recoverable failures.
9. Klak pauses when identity, payment, legal acceptance, secrets, or human judgment are required.
10. Klak provides a completion report and action history.

The user should always have:

- Pause
- Resume
- Take over
- Cancel
- Emergency stop
- View current step
- View actions taken
- View files changed
- View approvals requested

---

## 6. Operating modes

### 6.1 Observe mode

Klak can inspect the screen and computer state but cannot make changes.

Use cases:

- Diagnosing a problem
- Explaining what is happening
- Reviewing a workflow
- Producing a proposed plan

### 6.2 Assisted mode

Klak performs normal low-risk work automatically and pauses before sensitive or consequential actions.

This should be the default mode.

Examples requiring approval:

- Sending an email or message
- Publishing content
- Installing or uninstalling software
- Deleting files
- Changing security settings
- Deploying to production
- Submitting a form
- Starting a payment
- Accepting legal terms
- Sharing private information

### 6.3 Autopilot mode

Klak completes an approved workflow without stopping inside a defined scope.

The scope may include:

- Approved applications
- Approved folders
- Approved websites
- Approved commands
- Approved recipients
- Time limits
- Cost limits
- Maximum number of actions

### 6.4 Unattended mode

Klak runs scheduled or event-triggered tasks while the user is away.

This mode must use strict permissions, isolated credentials, audit logging, and clear limits.

---

## 7. Execution strategy

Klak should not always imitate mouse movement. It should use the most reliable method available.

Preferred order:

1. **Application APIs and structured integrations**
2. **Local tools, MCP tools, and application commands**
3. **Shell commands and scripts**
4. **Direct filesystem operations**
5. **Browser DOM and accessibility automation**
6. **Windows UI Automation and accessibility trees**
7. **Screenshot vision with mouse and keyboard control**
8. **Human takeover**

Examples:

- Editing `.env` through the filesystem is better than opening Notepad.
- Calling the Chatwoot API is better than navigating through many UI screens.
- Reading a browser DOM is better than guessing button coordinates.
- Mouse-and-keyboard control is still essential when no structured interface exists.

This hybrid approach is a major Klak advantage. Pure screenshot-clicking is too slow and unreliable for many real workflows.

---

## 8. Core architecture

### 8.1 Goal interpreter

Converts the user's request into:

- Desired final state
- Constraints
- Allowed scope
- Required applications
- Risk level
- Verification criteria

### 8.2 Planner

Breaks the goal into:

- Steps
- Dependencies
- Checkpoints
- Approval points
- Recovery options
- Completion conditions

The planner should revise the plan when the environment changes.

### 8.3 Computer observer

Collects state from:

- Screenshots
- Accessibility trees
- Browser DOM
- Window titles
- Running processes
- Open applications
- Filesystem state
- Clipboard state
- Notifications
- Application logs
- Terminal output

### 8.4 Tool router

Chooses the best execution method for each step:

- API
- MCP connector
- PowerShell
- Command Prompt
- Filesystem
- Browser automation
- Windows UI Automation
- Mouse and keyboard
- Application-specific plugin

### 8.5 Action executor

Performs controlled actions such as:

- Launching applications
- Opening files
- Clicking
- Typing
- Selecting
- Dragging
- Scrolling
- Copying and pasting
- Running commands
- Moving and renaming files
- Calling APIs
- Uploading and downloading
- Waiting for events

### 8.6 Verifier

Never assumes that an action succeeded.

Verification methods include:

- Checking the new screen state
- Reading confirmation messages
- Inspecting files
- Checking exit codes
- Running tests
- Calling health endpoints
- Comparing before-and-after state
- Reading application logs
- Confirming records through an API

### 8.7 Recovery engine

When a step fails, Klak should:

1. Observe again.
2. Classify the failure.
3. Retry only when safe.
4. Choose an alternative tool.
5. Restore a checkpoint when possible.
6. Ask the user only when the failure cannot be resolved safely.

### 8.8 Memory

Klak may remember:

- Application locations
- Project folders
- User preferences
- Known workflows
- Previous fixes
- Safe commands
- Approved websites
- Repeated tasks
- Device-specific behavior

Memory must be visible, editable, and removable by the user.

### 8.9 Audit system

Every meaningful action should record:

- Timestamp
- User goal
- Application
- Action
- Reason
- Result
- Files changed
- Command executed
- Approval used
- Error encountered
- Recovery performed

---

## 9. Safety and trust

A computer operator is powerful. Trust must be part of the architecture, not an afterthought.

### 9.1 Least privilege

Klak should receive only the permissions needed for the current task.

Permissions should be scoped by:

- Application
- Folder
- Domain
- Command
- Account
- Duration
- Action type

### 9.2 Secret handling

Passwords, API keys, payment details, and private tokens should:

- Never be placed into normal model prompts
- Be entered through secure takeover or a local secret broker
- Be masked in logs
- Be stored only when the user explicitly approves
- Be released only to the approved destination

### 9.3 Prompt-injection protection

Web pages, documents, emails, and images may contain malicious instructions intended to hijack an AI operator.

Klak should:

- Treat external content as untrusted data
- Separate user instructions from content being viewed
- Stop when a page attempts to override the user's goal
- Never reveal secrets because a webpage requests them
- Require approval before unexpected external actions
- Use domain and action allowlists
- Isolate browsing contexts where practical

### 9.4 Consequential-action approval

Klak should require explicit approval for actions such as:

- Sending or publishing
- Payments and purchases
- Deletion
- Production deployment
- Security changes
- Account permission changes
- Legal acceptance
- Sharing confidential information

### 9.5 Emergency stop

The user must be able to stop Klak instantly through:

- A global keyboard shortcut
- A visible stop button
- A tray-menu action
- An optional voice command

### 9.6 Checkpoints and rollback

Before risky modifications, Klak should create recoverable state where possible:

- File backups
- Git branches or commits
- Configuration snapshots
- Restore points
- Drafts instead of direct sending
- Staging before production

---

## 10. Local-first design

Klak should run a trusted local controller on the user's computer.

The local component should own:

- Screen capture
- Accessibility access
- Keyboard and mouse control
- Filesystem access
- Application launching
- Secrets
- Permissions
- Audit logs
- Emergency stop

AI reasoning may be:

- Fully local
- Cloud-based
- Hybrid
- User-selectable

Cloud models should receive the minimum information necessary for the task.

A strong long-term design is:

```text
User goal
   |
   v
Local Klak controller
   |- Local policy and permissions
   |- Local secrets
   |- Local tools
   |- Screen and accessibility observer
   `- Audit log
          |
          v
   Optional cloud reasoning model
          |
          v
Local action execution and verification
```

---

## 11. Suggested Klak interface

### Main task panel

Shows:

- Current goal
- Current step
- Progress
- Applications being used
- Time elapsed
- Approval requests
- Pause, takeover, and stop controls

### Live activity view

Shows readable actions such as:

- Opened Chrome
- Navigated to Chatwoot
- Read inbox configuration
- Updated local environment file
- Restarted service
- Verified port 3002
- Sent test message
- Confirmed response

### Approval card

Explains:

- What Klak wants to do
- Why it is necessary
- What data will be affected
- Whether the action can be reversed

### Completion report

Includes:

- Outcome
- Actions completed
- Items not completed
- Files changed
- Errors and recoveries
- Suggested follow-up

---

## 12. Product roadmap

### Phase 1: Reliable local operator foundation

Build:

- Application discovery
- Application launcher
- PowerShell executor
- Filesystem tools
- Process inspection
- Window detection
- Windows UI Automation
- Screenshot capture
- Mouse and keyboard control
- Action logs
- Emergency stop
- Basic approval system

Target tasks:

- Open applications
- Navigate standard Windows interfaces
- Move and rename files
- Run approved commands
- Fill simple forms
- Complete short browser workflows

### Phase 2: Observe-plan-act-verify loop

Build:

- Goal interpreter
- Multi-step planner
- Step verification
- Recovery logic
- Retry limits
- Checkpoints
- Task-state persistence

Target tasks:

- Set up a local project
- Diagnose a failed service
- Complete a browser workflow
- Prepare a document from multiple files
- Configure a third-party service

### Phase 3: Hybrid tool routing

Build:

- Browser DOM automation
- MCP support
- Application APIs
- Structured connectors
- Tool-selection scoring
- Application-specific skills

Target tasks:

- Email and calendar workflows
- Business dashboards
- Support systems
- Developer environments
- Document and spreadsheet workflows

### Phase 4: Safe autonomy

Build:

- Permission profiles
- Secure secret broker
- Prompt-injection detection
- Unattended mode
- Scheduled tasks
- Event triggers
- Rollback
- Policy templates

### Phase 5: Skill marketplace

Allow trusted skills for applications and workflows.

Each skill should declare:

- Required permissions
- Supported applications
- Inputs and outputs
- Risk level
- Verification method
- Maintainer
- Version
- Test coverage

---

## 13. Klak's differentiation

Klak should not compete only on having a model that can click.

Its advantage should be the complete operating system around the model:

- Local control
- Hybrid API, command, DOM, accessibility, and vision execution
- Verification after every meaningful action
- Recovery and rollback
- Transparent permissions
- Secure secrets
- Application memory
- User-visible audit trails
- Long-running task persistence
- Ability to work across unrelated applications
- User takeover at any moment

The strongest positioning is:

> Klak is the trusted local AI operator for your computer. It can use applications, websites, files, commands, and connected services to complete real work from start to finish.

---

## 14. Existing tools and market state as of June 2026

The idea already exists in several forms, which confirms that the market is real. However, no product has completely solved reliable, unrestricted, cross-application operation on an ordinary personal computer.

### 14.1 ChatGPT agent

OpenAI's ChatGPT agent can use its own virtual computer to browse websites, work with files, use connected data sources, fill forms, analyze information, and produce deliverables.

**Why it is successful:**

- Strong reasoning and research
- Integrated tools
- Consumer-friendly interface
- User takeover and confirmations
- Useful for web-heavy tasks

**Current limitation relative to Klak:**

- It mainly operates a managed virtual environment rather than becoming a persistent operator for every application on the user's own Windows computer.
- Sensitive or consequential actions still require supervision.
- Web prompt injection remains a significant security problem.

### 14.2 OpenAI Codex background computer use

By 2026, Codex gained background computer-use capabilities that can see, click, type, and use applications, particularly for developer workflows.

**Why it is successful:**

- Clear focus on development
- Strong terminal and code integration
- Can combine structured tools with visual application use
- Delivers value in testing and software workflows

**Current limitation relative to Klak:**

- Developer-focused rather than a general computer operator for every user.
- Platform and application coverage remain narrower than Klak's intended vision.

### 14.3 Anthropic Claude computer use and Cowork

Anthropic provides computer-use APIs and Claude Cowork, which can work with local files and applications, inspect screenshots, move the pointer, click, type, and perform desktop tasks.

**Why it is successful:**

- It is one of the closest products to the Klak vision.
- It supports direct desktop interaction.
- It combines planning, files, applications, and computer use.
- It emphasizes user control and safety.

**Current limitation relative to Klak:**

- Computer use still requires careful supervision.
- Prompt injection can cause models to follow malicious instructions embedded in webpages or images.
- Reliability varies across applications and long workflows.

### 14.4 Microsoft Copilot Studio computer use

Microsoft's computer-use feature became generally available in May 2026. It allows agents to automate websites and Windows desktop applications using a virtual mouse and keyboard on configured machines.

**Why it is successful:**

- Strong enterprise distribution
- Governance, identity, and compliance controls
- Connection to Microsoft 365, Dataverse, Power Platform, and Cloud PCs
- Natural-language automation for systems without APIs

**Current limitations:**

- Microsoft's own FAQ reports approximately 80% success on web tasks but roughly 35% on desktop applications.
- Dynamic controls, custom widgets, timing changes, and unusual desktop interfaces remain difficult.
- It is designed primarily for configured enterprise environments rather than as a simple personal local operator.

### 14.5 Google Gemini Agent and Project Mariner

Project Mariner began as a browser-using research prototype. Its ideas later became part of Gemini Agent, Gemini computer-use models, AI Mode, and other Google products.

**Why it is successful:**

- Strong browser understanding
- Integration with Google Workspace
- Ability to research, browse, and perform multi-step web tasks
- Confirmation before critical actions

**Current limitation relative to Klak:**

- The strongest integration remains browser and Google-service focused.
- It does not yet represent a universal persistent operator across every local desktop application.

### 14.6 UiPath and traditional RPA

UiPath, Microsoft Power Automate, and other robotic-process-automation platforms have automated computer workflows for years. UiPath now combines AI agents, software robots, and human oversight.

**Why they are successful:**

- Deterministic workflows
- Enterprise governance
- Detailed auditability
- Stable execution for known processes
- Strong integration with business applications

**Why they have not become a universal personal AI operator:**

- Traditional automations often require specialists to build and maintain them.
- Recorded UI flows can break when interfaces change.
- They are strongest on predefined processes rather than completely new goals.
- Licensing and deployment can be complex for individual users.

Klak should combine RPA reliability with modern AI flexibility.

### 14.7 Adept ACT-1

Adept introduced ACT-1 in 2022 with almost the same central idea: a model that could use software, APIs, and web applications like a person.

In 2024, Adept's co-founders and part of its team joined Amazon, while Amazon licensed Adept's agent technology and models. Adept continued with an enterprise focus.

**Important lesson:**

A compelling demo is not enough. A general action model must also achieve:

- Reliable execution
- Clear commercial use cases
- Manageable infrastructure cost
- Security
- Enterprise trust
- Strong product distribution
- Consistent performance across real applications

---

## 15. Why general computer operators have not fully taken over

### 15.1 Reliability falls sharply on long tasks

A single click may work, while a workflow involving many applications, decisions, and changing states can fail early.

Research published in 2026 found leading computer-use agents achieved below 21% success on complex professional multi-application tasks. Another enterprise benchmark found success of only 9% to 19% on complex workflows, despite much stronger performance on simple UI actions.

### 15.2 Desktop applications are harder than websites

Desktop applications differ widely in:

- Rendering
- Accessibility support
- Custom controls
- Window behavior
- Timing
- Permissions
- Keyboard shortcuts
- Display scaling

Microsoft reports a large gap between web and desktop computer-use success.

### 15.3 Visual operation is slow

Screenshot-based agents repeatedly:

1. Capture the screen.
2. Send it to a model.
3. Reason.
4. Return one or a few actions.
5. Wait for the result.
6. Repeat.

Research shows planning and reflection calls create high latency, and agents often use more steps than a human.

### 15.4 Interfaces change

Buttons move, text changes, popups appear, and sessions expire. Coordinate-based automation is especially fragile.

### 15.5 Security risks are serious

An operator can access:

- Email
- Files
- Credentials
- Private messages
- Business systems
- Payments
- Production infrastructure

A malicious webpage or document may contain prompt-injection instructions that attempt to redirect the agent or steal data.

### 15.6 Verification is often weak

Many systems perform an action but do not reliably prove that the intended final state was reached.

Klak must treat verification as a first-class component.

### 15.7 Cost can grow quickly

Long tasks may require:

- Many screenshots
- Large model calls
- Repeated retries
- Long context
- Hosted virtual machines

A local-first hybrid architecture can reduce some of this cost.

### 15.8 Users do not trust invisible autonomy

Users need:

- Clear progress
- Approval controls
- Takeover
- Audit logs
- Reversibility
- Predictable boundaries

### 15.9 "Do anything" is too broad for a first product

Successful products normally begin with a valuable, constrained set of tasks and expand after proving reliability.

---

## 16. Why some products are succeeding

The products gaining adoption share several traits:

- They focus on specific high-value workflows.
- They combine AI with structured tools rather than relying only on mouse clicks.
- They ask for confirmation before consequential actions.
- They operate in managed or isolated environments.
- They provide enterprise governance or trusted consumer distribution.
- They keep a human able to pause or take over.
- They use deterministic automation where possible.
- They verify results and expose action history.

Klak should follow these lessons while preserving the larger universal-computer-operator vision.

---

## 17. Strategic recommendation for Klak

Do not attempt unrestricted "do anything" autonomy in the first release.

Build the universal architecture, but launch with several reliable task families:

1. File and folder operations
2. Application launching and navigation
3. Browser workflows
4. Developer setup and diagnostics
5. Document and spreadsheet tasks
6. Repetitive office workflows
7. Local support and troubleshooting

Each task family should have:

- Defined permissions
- Known tools
- Verification
- Recovery
- Test cases
- Approval rules
- Success metrics

Then expand application by application.

---

## 18. Success metrics

Track:

- End-to-end task completion rate
- Completion without human intervention
- Average number of user questions
- Incorrect-action rate
- Recovery success rate
- Average task time
- Average model cost
- Number of actions per task
- Approval frequency
- User takeover frequency
- Rollback frequency
- Prompt-injection detection rate
- User trust and satisfaction

The main product metric should be:

> Percentage of user goals completed correctly, safely, and verifiably without unnecessary conversation.

---

## 19. Immediate next build

The next practical Klak milestone should be:

### Computer Operator v1

Include:

- Windows application discovery
- Window and process inspection
- Windows UI Automation
- Screen capture
- Mouse and keyboard executor
- PowerShell executor
- Filesystem tools
- Browser automation
- Observe-plan-act-verify loop
- Approval gates
- Emergency stop
- Local action log
- Step retry and timeout
- User takeover
- Basic checkpointing

### First demonstration workflow

A strong demonstration would be:

> "Open this project, start the required services, expose the local server through ngrok, configure the Chatwoot bot, send a test message, verify the response, and report what happened."

This demonstration proves that Klak can:

- Work across terminal, browser, files, local services, and cloud dashboards
- Handle secrets safely
- Use APIs and GUI interaction
- Verify end-to-end results
- Recover from errors
- Reduce human back-and-forth

---

## 20. Final product statement

Klak should become a trusted local AI operator that can perform real work across the user's computer.

It should understand outcomes, select the best tools, operate applications, control the interface when necessary, verify results, recover from failure, protect the user's data, and keep the user in control.

The long-term goal is not merely an assistant that tells the user what to do.

The goal is:

> An AI that can sit at the computer on the user's behalf and complete legitimate digital work as reliably, transparently, and safely as a trusted human operator.

---

## 21. Research references

Accessed in June 2026.

- OpenAI — Introducing ChatGPT agent  
  https://openai.com/index/introducing-chatgpt-agent/

- OpenAI — Computer use API guide  
  https://developers.openai.com/api/docs/guides/tools-computer-use

- OpenAI — Codex for almost everything  
  https://openai.com/index/codex-for-almost-everything/

- OpenAI — Introducing GPT-5.5  
  https://openai.com/index/introducing-gpt-5-5/

- Anthropic — Claude computer use documentation  
  https://docs.anthropic.com/en/docs/build-with-claude/computer-use

- Anthropic — Claude Cowork  
  https://www.anthropic.com/product/claude-cowork

- Anthropic — Prompt-injection defenses for browser use  
  https://www.anthropic.com/research/prompt-injection-defenses

- Microsoft — Copilot Studio computer use  
  https://learn.microsoft.com/en-us/microsoft-copilot-studio/computer-use

- Microsoft — Computer use FAQ and limitations  
  https://learn.microsoft.com/en-us/microsoft-copilot-studio/faqs-computer-use

- Google — Gemini universal AI assistant and Project Mariner  
  https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-universal-ai-assistant/

- Google — Gemini 2.5 Computer Use model  
  https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-computer-use-model/

- Google — Gemini Agent  
  https://blog.google/products-and-platforms/products/gemini/gemini-3-gemini-app/

- UiPath — Agentic automation platform  
  https://www.uipath.com/newsroom/uipath-launches-first-enterprise-grade-platform-for-agentic-automation

- Adept — ACT-1  
  https://www.adept.ai/blog/act-1/

- Adept — 2024 company update  
  https://www.adept.ai/blog/adept-update/

- OSWorld benchmark  
  https://arxiv.org/abs/2404.07972

- OSWorld-Human efficiency benchmark  
  https://arxiv.org/abs/2506.16042

- WindowsWorld multi-application benchmark  
  https://arxiv.org/abs/2604.27776

- UI-CUBE enterprise computer-use benchmark  
  https://arxiv.org/abs/2511.17131

- OS-Harm computer-use safety benchmark  
  https://arxiv.org/abs/2506.14866
