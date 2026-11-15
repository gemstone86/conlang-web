# Root and Rune + Weather generator

One web app with a start page and one login for two tools:

| Path | What |
|---|---|
| `/` | Start page: log in, register, change or reset your password, and pick an app |
| `/rune/` | **Root and Rune**, the conlang builder (this README, below). API: `/rune/api/…` |
| `/weather/` | **Weather generator** (Eon Weather): weather, calendars, the world map and campaign notes. See [WEATHER.md](WEATHER.md). API: `/weather/api/…` |
| `/api/auth/…` | The shared login: `me`, `login`, `register`, `logout`, `password`, `reset` |
| `/admin/` | Admin dashboard: all accounts (admins only); data from `/api/admin/users` |

Spring Boot 3.3 · Java 21 · Maven · one embedded H2 2.3.232 database file via JDBC · plain-JS front ends.

Code layout: `com.hub` (start-up, shared login, database guard), `com.conlangs.web` (Root and Rune),
`com.eonweather` + `weather`, `date`, `context`, `gui` (the weather generator and its engine).
Pages: `src/main/resources/static/` (start page), `static/rune/`, `static/weather/`.

## Running it

    mvn spring-boot:run          (or run.bat / run.ps1)
    open http://localhost:8080

To build one jar: `mvn package`, then `java -jar target/root-and-rune.jar` (run it next to the `world/` folder, or the copy
packed in the jar is used). Docker: `docker compose up -d --build`.

**Publishing:** every merge into `main` is published to Azure App Service by the GitHub action *Deploy to Azure*, after
the tests pass. Setup and the Azure settings: WEATHER.md, *Putting it on the internet*.

**Accounts.** There is one account per person for both apps. The first account registered becomes the admin of
both. Root and Rune needs you to be logged in; the weather generator can be used without logging in (logging in saves
notes, campaigns and maps). Weather admins are the site admins plus any usernames in `EON_ADMINS` (default
`Gemstone,Gemstone86`); once one of those names is registered, the others can't be registered by anyone else.
Forgotten password: an admin issues a reset code in Root and Rune (**Issue reset code**), and the user enters it on
the start page.

**Version and tests.** The version is written in one place, `pom.xml`; the pages read it from `/version.js` (filled in when the app is built). `mvn package` runs the Java tests (the whole app on a fresh database); `node --test src/test/js/*.test.js` runs the weather page's own (travel rules, the painter, the texts). Both run in the GitHub workflows.

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
| `EON_IMPORT` | `auto` | moving the old weather database in (below): `auto`, `force` or `off` |
| `EON_IMPORT_FROM` | `eonweather.mv.db` next to the `DB_URL` file | the old weather database file |

These replace the separate apps' `CONLANG_*` and `EON_DB_*` / `EON_REGISTRATION` / `EON_SECURE_COOKIE` settings.

**Moving from the separate Root and Rune app.** In the old app (v0.24.3 or later), log in as admin and click
**Export everything**: one JSON file with all accounts, worlds, languages, words, forms, sound changes, grammar, sounds,
sentences, sharing, pending changes and undo history. In this app, register your account, then in Root and Rune click
**Import everything** and pick the file. Accounts are matched by username: one that exists here keeps its password
here, the others are created with their old passwords. Everything else keeps its ids. Importing replaces Root and
Rune's data here (you're asked first if there is any); accounts are never deleted.

**Moving from the separate weather generator.** Its database is moved in by itself the first time this app starts:
put the old `eonweather.mv.db` in the same folder as this app's database (`./data/` locally, `/home/data/` on Azure,
where the old app already left it), or point `EON_IMPORT_FROM` at it. Everything comes along: accounts, maps with
their anchors, height maps, rivers, roads, ranges, nations, forest, ice, leylines and high-magic areas, journeys,
suggestions and votes, notes, campaigns, regions made in the app, symbols and the admin settings. Ids are kept.
Accounts are matched by username (any letter case): one that exists here keeps its password here, the others are
created with their old passwords (stored again in this app's format the first time they log in). If no account
existed here yet, the weather admins (`EON_ADMINS`) become site admins.
The old file is only read (a copy is opened), and the move runs in one transaction: if anything fails, nothing
changes, the log says why, and the app starts anyway. It runs once (it leaves a note in the database), and it never
replaces weather data people have already made here (notes, campaigns, own maps, journeys, suggestions); to replace it
anyway, start once with `EON_IMPORT=force`, then set it back. `EON_IMPORT=off` turns it off. The standard map is
updated to this version's right after.

## Claude connector

Lets Claude (claude.ai) read your languages and weather data while helping you. It's an MCP server built into the app,
at `/mcp/<key>`, with read-only tools:

- Root and Rune: `rune_list_languages`, `rune_language`, `rune_words` (with a search), `rune_search_words` (all languages),
  `rune_word_history`, `rune_sound_changes`, `rune_preview_sound_change` (needs editor access), `rune_sound_change_versions`,
  `rune_compare_sound_change_version`, `rune_word_form_rules`,
  `rune_grammar`, `rune_sounds`, `rune_sentences`, `rune_build_sentence`, `rune_missing_words`, `rune_pending_changes`,
  `rune_edit_log`, `rune_suggest_roots`.
- Weather generator: `weather_world` (regions, calendars), `weather_day`, `weather_month`, `weather_maps`,
  `weather_campaigns`, `weather_notes`, and `weather_get` for any other read-only data (rivers, nations, trips…).

**Setting it up:** register an account for Claude on the start page (e.g. *Claude*) and share the worlds or languages
it should read with it as *viewer* (or use your own account to let it see everything you see). In Root and Rune, an
admin opens **Claude connector** in the top bar, picks the account and clicks **Make connector address**. In claude.ai,
**Settings → Connectors → Add custom connector**, paste the address. The address is shown once; anyone who has it
can read what that account can see, so revoke it on the same page if it leaks. Every call is in the Log (category
*connector*). Only a hash of each key is stored (table `connector_keys`).

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
sentence builder, automatic coupling of the sound inventory to the sound-change rules, e-mail reset,
and script/calligraphy. Language settings (classes, erosion, tree position) can be edited by the language owner only.
Deleting a word also deletes its locked overrides, and Undo does not bring those back.

## Tests
`mvn test` runs `EvolverTest` (family-tree inheritance, splits, overrides, bad regexes, erosion collision stop) and
`CombinedAppTest`, which starts the whole app on a fresh database and checks the start page, both apps and the shared login.

## Changes
What changed in each version is in [CHANGELOG.md](CHANGELOG.md).
