# Root and Rune + Weather generator

One web app with a start page and one login for two tools:

| Path | What |
|---|---|
| `/` | Start page: log in, register, change or reset your password, and pick an app |
| `/rune/` | **Root and Rune**, the conlang builder (this README, below). API: `/rune/api/…` |
| `/weather/` | **Weather generator** (Eon Weather): weather, calendars, the world map and campaign notes. See [WEATHER.md](WEATHER.md). API: `/weather/api/…` |
| `/api/auth/…` | The shared login: `me`, `login`, `register`, `logout`, `password`, `reset` |

Spring Boot 3.3 · Java 21 · Maven · one embedded H2 2.3.232 database file via JDBC · plain-JS front ends.

Code layout: `com.hub` (start-up, shared login, database guard), `com.conlangs.web` (Root and Rune),
`com.eonweather` + `weather`, `date`, `context`, `gui` (the weather generator and its engine).
Pages: `src/main/resources/static/` (start page), `static/rune/`, `static/weather/`.

## Running it

    mvn spring-boot:run          (or run.bat / run.ps1)
    open http://localhost:8080

To build one jar: `mvn package`, then `java -jar target/root-and-rune.jar` (run it next to the `world/` folder, or the copy
packed in the jar is used). Docker: `docker compose up -d --build`.

**Accounts.** There is one account per person for both apps. The first account registered becomes the admin of
both. Root and Rune needs you to be logged in; the weather generator can be used without logging in (logging in saves
notes, campaigns and maps). Weather admins are the site admins plus any usernames in `EON_ADMINS` (default
`Gemstone,Gemstone86`); once one of those names is registered, the others can't be registered by anyone else.
Forgotten password: an admin issues a reset code in Root and Rune (**Issue reset code**), and the user enters it on
the start page.

**Database.** One H2 file, `./data/hub.mv.db`, holding both apps' tables. It is guarded like the weather generator's
was: a copy of the app starting up waits for the old one to hand the file over, a damaged file is repaired (or
restored from the newest backup), and backups are written to `./data/backups/` (see WEATHER.md, *Backups*).

### Eclipse
1. File → Import → Maven → Existing Maven Projects → pick this folder.
2. If you see red errors: right-click the project → Maven → Update Project (tick Force Update).
3. Run `com.hub.HubApplication` as a Java Application, then open http://localhost:8080.

### Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `DB_URL` | `jdbc:h2:file:./data/hub;MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE` | keep `NON_KEYWORDS=YEAR` |
| `DB_USER` / `DB_PASSWORD` | `sa` / empty | |
| `REGISTRATION` | `true` | `false` = only existing accounts (the first account can always be made) |
| `SECURE_COOKIE` | `false` | `true` behind HTTPS |
| `EON_ADMINS` | `Gemstone,Gemstone86` | extra weather admins |
| `EON_WORLD_DIR` | `world` | the weather generator's region and calendar files |
| `EON_DB_BACKUP_HOURS` / `EON_DB_BACKUPS` | `6` / `14` | backup interval and how many to keep |

These replace the separate apps' `CONLANG_*` and `EON_DB_*` / `EON_REGISTRATION` / `EON_SECURE_COOKIE` settings.

**Moving from the two separate apps.** The combined app starts with a new, empty database (`data/hub.mv.db`);
it does not read the old `data/conlangs.mv.db` or `data/eonweather.mv.db`, and accounts have to be made again.

## How it works

* **World → languages.** A language can branch from a parent at a split year. A branch inherits each word as it
  stood at the split year, then evolves with its own rules.
* **Words** have a gloss, type, build, form and the year they were coined. Their dated history is *computed* from
  the sound-change rules of the language and its descendants. Open **History** on a word to see it, or to **lock** a
  form at a year (an override); later rules continue from the locked form.
* **Forms and form rules.** Every word can have extra grammatical forms (definite, plural, past ...). Each form is run through the
  sound changes separately, so with a rule `at > et` the base `ala` stays `ala` while its definite `alatou` becomes `aletou`.
  On the **Word forms** tab you define form rules: "words of type noun get the suffix tou, called definite", optionally with a
  condition (regex on the base form, e.g. `^a` for a-initial words) and an option to drop the first vowel when two vowels meet.
  The affix can be **linked to a dictionary word** (e.g. the word "definite" = tou): each form then uses that word as it stood in
  the year the form begins, so if a sound change turns tou into toe in year 300, words from then on get -toe, while older words
  change through the same sound change. Forms are stored; after editing sound changes or the affix word, use **Rebuild all**.
  New words get their forms automatically; owners can add missing forms to all existing words, or rebuild one form for every word.
  A row on the Grammar tab can be turned into a form rule with its **→ word form** button.
  Click a word in the dictionary to see and edit its forms and their histories.
* **Dictionary paging**: 25 / 50 / 100 / 250 words per page (remembered in your browser).
* **Sound changes** are ordered per language by year and order. Patterns are Java regexes with extras: `{V}` expands to a
  class defined in Settings (`V=aeiou`), a leading/trailing `#` is a word edge, and `$1` works in replacements.
  Templates (syncope, hiatus, haplology, geminates, clusters) fill in the fields. **Preview effect** lists which words
  would change before you add a rule.
* **Compound** joins words and runs the erosion steps from Settings (one pass each, until the target length is reached),
  stopping one step short of colliding with an existing word.
* **Sharing** (owner): viewer or editor, per language or for a whole world, revocable. Editor changes wait for the
  owner's approval (Changes tab) unless "auto-approve" is ticked for that user. Authors see their own pending changes.
* **Undo/redo** per language; editors undo only their own edits. **Export Excel** gives Dictionary, History, Rules, Languages.
* **Password reset**: the admin clicks "Issue reset code" and gives the user the one-time code (valid 24 h).
* **One-time import**: as admin, `POST /rune/api/admin/import-elven` (multipart `file`, `languageId`) reads the sheet
  "Ygg Elven dict" and imports root/derived/phrase rows. It skips "shifted"/"indexed" rows (regenerated from rules).

* **Grammar tab**: tables of rules (word order, tenses, affixes, prepositions...) grouped in sections, each section with its
  own column headings. Add, edit and delete rows and sections; changes follow the same approval and undo rules as the dictionary.
* **Sounds tab**: consonant and vowel grids. Give a sound a "from" / "until" year and the grid changes with the year you choose.
  (The years are entered by hand; they are not yet derived from the sound-change rules.)
* **One-time grammar import**: as admin, `POST /rune/api/admin/import-grammar` (multipart `file`, `languageId`, optional `replace=true`)
  reads the "Ygg Elven" sheet (settings, proto-vs-later, sound modifiers, pronunciation rules, grammar tables, consonant and vowel grids).

* **Admin log**: admins get a **Log** page (next to Workspace in the top bar) with errors, warnings and messages: logins, edits,
  approvals, imports, sharing. Unexpected errors keep their full stack trace; the error message in the app shows `log #N` so the
  entry is easy to find. Filter by level, category or text, download as text, or clear it. The latest 5000 entries are kept.
* **Word ids** are shown in the dictionary (first column, and searchable) and in the word popup.

## Not in this version
sentence builder, gaps view, automatic coupling of the sound inventory to the sound-change rules, e-mail reset,
and script/calligraphy. Language settings (classes, erosion, tree position) can be edited by the language owner only.
Deleting a word also deletes its locked overrides, and Undo does not bring those back.

## Tests
`mvn test` runs `EvolverTest` (family-tree inheritance, splits, overrides, bad regexes, erosion collision stop) and
`CombinedAppTest`, which starts the whole app on a fresh database and checks the start page, both apps and the shared login.

## v0.9.0
- A branch language's dictionary now also lists the parent words that existed when it split off, shown in the branch's own evolved form (tinted rows, "from <language>" badge, "Open in <language>" button). Words coined after the split are not shown. Toggle with "Show inherited words".
- Cross-references: a form that starts with `see `, starts with `=`, or contains `"` or `#` (e.g. `see "teot"`, `see #12`) is treated as a note and is never sound-changed.

## v0.10.0
- **Sentences tab**: write `(to see)(you-obj) (poss)(darkness)(pos-in) (me)`; each part is a dictionary meaning (`meaning-label` picks a word form, `meaning#12` picks by id, `=text` stays as written). Forms are taken as they are in the selected language at the given year (sound changes, locked overrides and branch splits included); missing words or forms are flagged as gaps. Sentences can be saved.
- **Change meaning** button in the word popup: from a year, a word in a language (and branches splitting off later) also means / changes to another meaning. Shown under the gloss in the dictionary; the sentence builder finds words by their current meanings. Goes through the normal edit/approval/undo pipeline.

## v0.12.0
- Word forms: "Rebuild group" per group; year defaults (form rule linked to a dictionary word starts at that word's year; new forms in the word popup start at the word's year) with a warning if set older than the word.
- Excel export: new sheets Check (latest form of the word and of every form type in every branch), Form rules (with group), Meanings, Sentences.

## v0.13.0
- Graphs tab: divergence between languages over time (average edit distance, or share of identical words).
- Word popup: evolution tree (branches at each split, rule on each step).
- Cross-references: a word whose form is `see "wind"` (or `see #12`) now uses the forms of the word it points to, in the dictionary, the sentence builder and the word popup.
