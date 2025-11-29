# AGENTS

This file tells AI agents (Codex CLI etc.) how to work on this repo.

---

## 1. Project overview

**Name:** TRAINAR-APP  
**Type:** Expo React Native app (TypeScript)  
**Platform:** iOS + Android (Expo)  

The app shows **live train and traffic information** with:

- A **map view** with trains and stations
- A **train panel** with stops, delays, operator info, etc.
- A **traffic panel** with incidents/events
- Search, filters, and navigation between views

The app talks to a **Node.js backend** (separate repo: “ServerSide - TRAINAR”) that:

- Calls the Trafikverket API (Sweden) and other transport APIs
- Returns JSON to the app via HTTP
- Handles AI summaries of traffic events using the OpenAI API

This repo is mainly the **mobile client** – do **not** assume you can change the backend code here.

---

## 2. Tech stack & conventions

- **Language:** TypeScript
- **Framework:** React Native via Expo
- **Navigation:** Expo Router or React Navigation (check `App.tsx` / navigation files)
- **State:** React hooks + custom stores (e.g. `trainPositionsStore.ts`)
- **Maps:** Likely Mapbox or similar (see `TrainMap.tsx` / `TrainMapContainer.tsx`)
- **API clients:** Custom fetch helpers (e.g. `trafikverket.ts`, other lib files)

**General code style**

- Prefer **functional components** with hooks.
- Use **TypeScript types/interfaces** – do not “any” away the types unless absolutely necessary.
- Keep UI layout consistent with existing design (mostly black/white, modern, minimal).
- Name files and symbols in **English** and in a way that clearly describes their purpose.

---

## 3. Environment & configuration

Environment variables are provided via `.env` and Expo:

- `TRAFIKVERKET_API_KEY`
- `EXPO_PUBLIC_TRAFIKVERKET_API_KEY`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SUPABASE_PASSWORD_REDIRECT` (optional, for password reset links)
- Potentially more – read `.env.example` or existing `.env` usage.

**Rules for env handling**

- **Never hardcode** API keys, secrets, or tokens.
- If you need a new config value, add a **descriptive env name** and:
  - Reference it via `process.env` on the backend side, or
  - `process.env.EXPO_PUBLIC_...` on the client where appropriate.
- If you introduce a new env var, **document it clearly** in this file and where it’s used.

---

## 4. Directory structure (high-level)

*(Adjust this list based on the actual repo; don’t invent folders that don’t exist.)*

Typical important locations:

- `App.tsx`  
  Root app entry. Sets up providers, navigation, and global layout.

- `components/`
  - `trains/`
    - `TrainMap.tsx`, `TrainMapContainer.tsx`
    - `TrainPanel.tsx`, `TrainPanelContainer.tsx`
  - `traffic/`
    - Traffic panels/cards and related UI
  - Common UI elements, navigation, etc.

- `lib/`
  - `trafikverket.ts` — Trafikverket API client and helpers
  - Other API clients, utilities, or hooks

- `hooks/`
  - Example: `useTrainPositions.ts` – fetching and memoizing live train positions
  - Other domain-specific hooks

- `types/`
  - `trains.ts` – `TrainPosition`, `TrainStop`, etc.
  - Other shared TypeScript types

- `store/` or `*Store.ts`
  - State stores (e.g., `trainPositionsStore.ts`)

When modifying structure, keep related files grouped logically and avoid huge “god” modules.

---

## 5. How agents should work

### 5.1. General behavior

When you (Codex / AI agent) make changes:

1. **Explain your plan briefly** before large edits.
2. Make **small, coherent changes** rather than giant refactors.
3. Keep commits logically grouped by feature/bugfix (if asked to produce git steps).
4. Favor **backwards-compatible** changes over breaking ones, unless explicitly told otherwise.

### 5.2. Allowed tasks (safe without extra approval)

You may do these without asking for extra approval, as long as you keep changes focused:

- Small **bug fixes** (runtime errors, type errors, obvious logic bugs).
- **Refactors** that:
  - Don’t change behavior
  - Improve clarity, types, or component structure
- **UI tweaks** that:
  - Make layout more consistent
  - Fix obvious spacing/alignment issues
- **Type improvements**:
  - Replace `any` with proper interfaces
  - Add missing types for API responses
- **Documentation improvements**:
  - Add or update comments where the code is confusing
  - Add brief usage notes or docstrings to complex hooks

### 5.3. Tasks that require extra care / explicit request

Only do these when specifically asked for:

- Introducing **new major dependencies** in `package.json`.
- Large **architecture changes** (e.g., replacing state management library, navigation method).
- Changes that alter **API contracts** between the app and backend.
- Removing or deprecating existing features.

If you think one of these is necessary, propose it clearly and explain the trade-offs.

---

## 6. Working with APIs (Trafikverket, backend, etc.)

### 6.1. Trafikverket API

- All raw communication with Trafikverket should happen **in the backend** or a dedicated client in `lib/`.
- The frontend should **not** talk directly to Trafikverket with secrets.
- Use existing helpers where possible (e.g. `trafikverket.ts` and `useTrainPositions.ts`).
- Respect the current **JSON response format**: Trafikverket now has a JSON endpoint; do not reintroduce obsolete `format="json"` XML attributes.

### 6.2. TRAINAR backend (ServerSide)

- The **API base URL** is configured via `EXPO_PUBLIC_API_BASE_URL`.
- The frontend should only call **documented endpoints** (e.g. `/api/trains`, `/api/traininfo/:ident`, traffic summary endpoints).
- If you need a new field from the backend:
  - First, **assume it can be added to an existing JSON response** rather than creating a whole new endpoint.
  - Document the expected shape in the **TypeScript types**.

### 6.3. AI summaries

- AI summarization of traffic events is handled by the **backend** using OpenAI.
- On the client, treat summaries as **read-only strings** or structured data coming from the backend.
- Do not attempt to call the OpenAI API directly from the app.

---

## 7. UX / UI guidelines

- Visual style: **Scandinavian minimal**, black/white, clean, no clutter.
- Panels (train, traffic, station):
  - Should be **scrollable**, with smooth gestures.
  - Use a **layered / sheet** design when draggable.
  - Avoid elements overlapping in a way that hides content.
- When you update a panel:
  - Preserve existing **behavior** (e.g., click a train → show panel with route and stops).
  - Don’t remove fields currently shown unless asked.

If you add new UI:

- Keep typography and spacing consistent with existing screens.
- Prefer **simple layouts** (flexbox, stack views) over deeply nested structures.

---

## 8. Testing & quality checks

When you change code:

1. Ensure it **type-checks** (`tsc`) and the app can compile.
2. Avoid introducing **console errors** in runtime.
3. For data fetching:
   - Handle **loading** and **error** states gracefully.
   - Don’t assume API data is always present; use null checks.

If you add new functions/components:

- Write them so they are **pure** where possible.
- Keep side effects inside hooks (e.g. `useEffect`) or clear utilities.

---

## 9. Commit / change descriptions (for Codex)

When generating change logs, commit messages, or summaries:

- Use short but descriptive messages, e.g.  
  - `feat: add operator info to train panel`  
  - `fix: align bottom sheet snapping to top position`  
  - `refactor: extract Trafikverket JSON client`

If asked to provide a “what I did” summary, include:

1. Files touched
2. Short description of each logical change
3. Any follow-up work or TODOs

---

## 10. Things you must NOT do

- **Never** commit API keys, tokens, or secrets.
- Do not remove environment variable usage or replace it with hardcoded values.
- Do not introduce **breaking changes** to app-backend contracts without explicit instruction.
- Do not install heavy or unusual dependencies just for convenience (e.g., huge UI kits) without being asked.
- Do not delete large swathes of code without explaining what is being replaced and why.

---

## 11. If something is unclear

If project intent is ambiguous:

- Prefer **minimal and local changes** that clearly improve stability or clarity.
- Add small comments like `// TODO: Confirm with maintainer whether X should also include Y` rather than guessing and breaking behavior.

This AGENTS file is meant to keep AI work predictable and safe.  
Follow it, and keep the TRAINAR app stable, fast, and clean.
