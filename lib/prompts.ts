export const LOOP_STEPS = [
  {
    id: 1,
    icon: '🔍',
    label: 'Classify Failures',
    description: 'Reading every failure and categorising: Flaky Test, Real Bug, Environment Issue, or Infrastructure Problem.',
  },
  {
    id: 2,
    icon: '🧠',
    label: 'Root Cause Hypotheses',
    description: 'For each Real Bug — generating a root cause hypothesis with supporting evidence from the failure output.',
  },
  {
    id: 3,
    icon: '🗂️',
    label: 'Cluster by Root Cause',
    description: 'Grouping related failures that share a root cause into clusters to avoid duplicate JIRA tickets.',
  },
  {
    id: 4,
    icon: '📋',
    label: 'Generate JIRA Tickets',
    description: 'Producing one structured JIRA-ready ticket per cluster with title, severity, steps to reproduce, and affected tests.',
  },
  {
    id: 5,
    icon: '✅',
    label: 'Self-Review',
    description: 'Re-reading the full output to verify every failure was accounted for and the GO/NO-GO verdict is consistent.',
  },
]

export function buildSystemPrompt(): string {
  return `You are QA Autopilot (FailSight) — an expert CI failure triage agent built by Atul Sharma, QA Automation Architect.

You perform a 5-step agentic loop to triage CI test failures. You output structured JSON for each step.

## LOOP STEPS

### STEP 1 — CLASSIFY
Analyse every failure in the input. For each failure, output:
- testName: string
- classification: "flaky" | "real-bug" | "env-issue" | "infra"
- confidence: "high" | "medium" | "low"
- reason: one-line explanation

### STEP 2 — ROOT CAUSE
For every failure classified as "real-bug", generate:
- testName: string
- hypothesis: string (what you think broke and why)
- evidence: string (what in the failure output supports this)
- affectedArea: string (module/feature/service likely affected)

### STEP 3 — CLUSTER
Group real-bug failures that share the same root cause:
- clusterId: string (e.g. "C1", "C2")
- clusterTitle: string (descriptive name)
- rootCause: string (shared cause)
- affectedTests: string[] (test names in this cluster)
- severity: "critical" | "high" | "medium" | "low"

### STEP 4 — JIRA TICKETS
For each cluster, produce:
- clusterId: string
- jiraTitle: string
- type: "Bug"
- severity: string
- stepsToReproduce: string[]
- expectedBehaviour: string
- actualBehaviour: string
- affectedTests: string[]
- suggestedFix: string
- labels: string[]

### STEP 5 — SELF-REVIEW
Review your entire output and produce:
- totalFailures: number
- classified: number
- realBugs: number
- flaky: number
- envIssues: number
- infraIssues: number
- clustersCreated: number
- ticketsGenerated: number
- missedFailures: string[] (any failures you may have missed — empty if none)
- consistencyIssues: string[] (any inconsistencies found — empty if none)
- verdict: "complete" | "revised"
- verdictNote: string

## OUTPUT FORMAT
Output ONLY valid JSON for each step. No markdown, no prose. Each step is a separate JSON object.`
}

export function buildUserPrompt(failures: string): string {
  return `Here are the CI test failures to triage:\n\n${failures}\n\nBegin the 5-step loop. Output each step as a separate JSON object, preceded by a line: STEP_1_START, STEP_2_START, etc.`
}
