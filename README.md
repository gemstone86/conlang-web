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

## v0.14.0
- Rebuild group / Rebuild all (per form) now also offers to remove existing forms that no longer fit any rule of their type (wrong word type, condition no longer matches). A list is shown first; forms whose type has no rule at all are never touched.

## v0.15.0
- References are now explicit: tick "reference to another word" when adding or editing a word and pick the word it stands for. The word then shows the forms (definite, plural …) of that word, in the dictionary, popup and sentences, and has no forms of its own. Stored as `see #id`, so it survives renaming the target. Old words written as `see "word"` keep working; edit and tick the box to convert them.
- Only `see …` and `=…` count as notes now; other text containing quotes or `#` is sound-changed as normal.
- Rebuild with removal also clears leftover forms of reference words.

## v0.15.1
- References to words coined after a branch split off now resolve (shown with the ancestor's form) instead of "refers to a word that was not found".
- A red banner appears when the page and the running server have different versions (stale backend). Keep `UI_VERSION` in app.js equal to the pom version.

## v0.16.0
- Dictionary: "Show only words with problems" button (with a count). A word has a problem when: no year is set (0), the form is empty, a sound change fails on it, or it refers to a word that doesn't exist. Problems are listed in red under the gloss.

## v0.17.0
- Sound changes: export as JSON and import it again. A rule with its id is adjusted, a rule without an id (or an unknown one) is added, `"delete": true` removes one; "remove rules that are missing from the file" removes the rest in the languages the file covers. The file is checked first (bad regexes, unknown languages, missing rights) and nothing is changed until you press Apply. Goes through the normal edit pipeline (approval and undo).

## v0.18.0
- Graphs tab: "Mergers" check. For the language and each branch: how many words had different forms at the split but are identical now, which sound changes merge the most forms, and the biggest groups of words that now sound the same. Locked overrides are not counted in the per-rule numbers.

## v0.18.1
- Sound changes: the "show rules for" dropdown is now three visible buttons (only this language / this language + all branches / full path) with a rule count, and the choice is remembered.

## v0.18.2
- A form that starts earlier than its word is no longer reported as a problem: the word simply uses the form as it has evolved by the word's own year.

## v1.9.0 (combined app)
- **Admin dashboard** at `/admin/` (admins only): every account with its role (site admin, weather admin from
  `EON_ADMINS`, user), when it joined and last logged in, and what it owns: worlds, languages and words in Root and
  Rune, campaigns, maps and notes in the weather generator, how many worlds or languages are shared with it, and its
  Claude connector addresses. Totals at the top; search and sort by any column. Linked from the start page (**Admin
  dashboard**) and from the **admin** badge there and in Root and Rune's top bar. Logins are recorded from this version on.

## v1.8.0 (combined app)
- **Import from Excel** (admins who own the language; on the Grammar and Bulk entry tabs): pick an .xlsx workbook, then
  **Import dictionary** (sheet "Ygg Elven dict": *dictionary*, *elven*, *build*, *year*, optionally *type*, *notes*, *group*)
  and/or **Import grammar and sounds** (sheet "Ygg Elven": grammar tables in columns A-G, consonant and vowel grids).
  The two importers existed already but had no button. Importing the dictionary again skips words that are there with
  the same meaning and form, so it doesn't add them twice; grammar asks before replacing what the language has.

## v1.7.0 (combined app)
- **Dictionaries are kept between page loads**: a worked-out dictionary is handed out again until anything in the data
  changes (in the test: 0.25–0.5 s → 30–70 ms for a repeat load). Any edit anywhere (a word, sound change, setting,
  tag switch, share, import…) makes the next load work it out afresh, so it's never out of date; the admin log and
  connector use don't count as changes. The 12 most recently used dictionaries are kept.

## v1.6.1 (combined app)
- **Faster dictionaries** (5–8× in a test with 6 languages, 240 sound changes, 2 300 words and 4 000 word forms:
  2.6 s → 0.5 s): each sound change's pattern is compiled once per request instead of for every word, form and branch;
  a branch gets its form at the split from the parent's run instead of running the parent's changes again; and a
  dictionary only evolves words into the languages it shows. The results are the same. Word histories, sentences and
  missing words use the same engine and get faster too.

## v1.6.0 (combined app)
- **Lost words**: in a word's window, **Mark as lost** in a language from a year (with an optional note). From that
  year the word is no longer used there: it shows greyed out with *lost 800* in the dictionary, sentences built for
  later years can't use it, and it shows up in Missing words again. Branches that split off after that year never get
  it (it isn't in their dictionary); branches that split off earlier keep it, unless it's marked lost there too.
  Goes through approval and undo like other edits; part of Export / Import everything.
- **Sentences at a given time**: the year field is now labelled *built as spoken in year*: each word is used as it was
  then (its form after the sound changes up to then, its meaning then). A word that can't be used says why:
  *'water' was lost in Proto in 800*, *'sky' isn't coined until 900*, or that it was coined after the split.

## v1.5.1 (combined app)
- Importing sound changes (JSON) can **tag everything in the file**: fill in *tag all imported* next to the file (one tag
  or several, comma separated). New sound changes get it, changed ones get it with their changes, and ones already in
  the app get it too (the check lists them as "changes tags"); their own tags are kept.

## v1.5.0 (combined app)
- **Tags on sound changes**: give a sound change tags (comma separated, e.g. `vowel shift, experimental`). The Sound changes
  tab shows every tag in view with its count; click one to see only those sound changes. The language's owner can
  **switch a tag off**: its sound changes are then left out wherever words evolve (dictionary, histories, sentences,
  missing words) in that language and all its branches, and shown greyed out, until it's switched on again.
- **Versions of sound changes**: *Versions* on the Sound changes tab saves a language's own sound changes (and its
  switched-off tags) under a name and note. **Compare** shows what has been added, removed and changed since, field by
  field; **Restore** (owner) puts them back as they were, after saving the current ones as a version, so a restore can
  be undone. Restoring clears the undo steps for sound changes in that language. Versions are part of Export / Import
  everything, and the Claude connector can list and compare them.
- Endpoints: `GET/POST /rune/api/languages/{id}/rule-versions`, `GET /rune/api/rule-versions/{vid}/compare`,
  `POST /rune/api/rule-versions/{vid}/restore`, `DELETE /rune/api/rule-versions/{vid}`, `POST /rune/api/languages/{id}/tag-switch`.

## v1.4.0 (combined app)
- **Claude connector**: read-only access for Claude (claude.ai) to Root and Rune and the weather generator, as one
  account, through an MCP server at `/mcp/<key>`. Admins make and revoke the addresses on the new **Claude connector**
  page. See *Claude connector* above.

## v1.3.0 (combined app)
- **Compound** tab: the language's missing words (and the meanings saved sentences need) are listed on the right, with a
  filter. Click one to coin the compound for it: its meaning and type are filled in, and **Use as word** saves the eroded
  form under that meaning, which takes it off the list. New *type* field for the compound.
- **Missing words** tab: a **Compound** button next to *Coin word* opens the Compound tab with that meaning picked.

## v1.2.0 (combined app)
- **Missing words** tab (next to Dictionary): mark meanings a language has no word for yet, one at a time or several at once
  (`meaning; type; note` per line). **Coin word** opens the dictionary with the meaning filled in; an entry is ticked off once the
  language has a word for it, its own or inherited (found the same way the sentence builder finds words), and
  **Remove the … that have a word now** clears those. Below the list: the meanings the saved sentences use but can't find,
  including words a branch lacks because they were coined in the parent after the split. Viewers see the list; owners and
  editors change it directly (it's a planning note, so no approval). Included in Export / Import everything.
- Endpoints: `GET/POST /rune/api/languages/{id}/missing`, `POST …/missing/bulk`, `POST …/missing/clear-filled`, `DELETE /rune/api/missing/{id}`.

## v0.18.3
- Dictionary search also finds reference words: search "see", "reference", or the name of the word they point to.

## v0.24.3
- **Export everything** (admins, in the top bar): downloads all of Root and Rune as one JSON file: accounts (with their password hashes, so passwords keep working), worlds, languages, words, word forms, overrides, meanings, sound changes, form rules, grammar, sounds, sentences, sharing, pending changes and undo history, every row with its id. The admin log and reset codes are left out. Endpoint: `GET /api/admin/export-all` in the separate app, `GET /rune/api/admin/export-all` here.
- Made for moving to this combined app, where an admin reads the file with **Import everything** (see *Moving from the separate Root and Rune app* above).

## v0.24.2

- Borrow: the word list is searchable by meaning and by form at the same time (each entry reads "meaning · form"), so you no longer have to look a word up in the other language first.

## v0.24.1

- Suggest new roots: a language with a syllable shape but fewer than 5 words (or none that fit) now gets forms written straight from the shape and the sounds in its Sounds tab. The message also says what is actually missing (words, or sounds).

## v0.24.0

- **Syllable shape** (Grammar tab, owners edit it): write the shape of a syllable with C, V and brackets for optional parts, e.g. `C(C)V(C)` or `(V)C(C)V(C)` (a leading `(V)` is an optional vowel at the start of a word only). sh, ch, gh, ng and diphthongs count as one sound. "Suggest new roots" now only proposes forms of that shape and learns from the existing words that fit it (if at least 5 do). A language without its own shape uses its parent's.
- Long vowels (ā, ī, ū, ō) and ǫ, ą now count as vowels when counting syllables for root suggestions; `gh` is a built-in digraph in the sound table builder.

## v0.23.0

- **Build the sound table from the word list** (Sounds tab, "Build from the word list"): reads the forms of every word at the language's split year, at each year one of its own sound changes starts, and at the chosen end year (default 900), and sorts the letters into the consonant and vowel tables. A slider walks from the split to the end year; sounds that appear (underlined) or disappear are listed with the sound changes that start that year, and hovering a sound shows its IPA, how many words use it and examples. Digraphs (sh, ch, th, ng) and diphthongs (ai, ou ...) count as one sound; long vowels (ā, á, â, a:) and umlauts are recognised. Letters you have already placed in the table keep their row and column.
- "Save as the sound table" stores each sound with its from / until years, so the normal table's year box shows the same history. A later build replaces the earlier auto-built entries (their notes start with "auto-built"); sounds you added by hand are never touched.
- New endpoints: `GET /rune/api/languages/{id}/auto-sounds?to=900`, `POST /rune/api/languages/{id}/auto-sounds/apply`.

## v0.22.0

- **Suggest new roots** (Words tab): learns which letters follow which from the words the language already has (including inherited ones) and writes new forms in the same style. Choose how many and how many syllables; forms that already exist, or are very close to an existing word, are never suggested. Click a suggestion to put it in the form field.

## v0.21.1

- Fixed: importing sound changes whose `language` names a language that doesn't exist in the world crashed with a NullPointerException. It now reports "unknown language 'X'" for that entry.

## v0.21.0

- **Sound importer** (Sounds tab): paste a table (`Symbol | Kind | Row | Column | Notes | From | Until`, separated by tabs, `|` or `;`) or choose a JSON file with a `sounds` list. "Check" shows what would be added or changed; sounds with the same symbol, kind and years are updated. Goes through the normal approval and undo.
- **Borrowing a word** (Words tab): tick *borrow*, pick the language the word comes from, pick the word, and give the year. The word enters the borrowing language with the form the source word had in the source language in that year; the borrowing language's own sound changes then apply. The link is shown as "borrowed from ...". The borrowed form is copied once and does not change if the source language's rules change later.
- **Bulk entry**: new option *skip words that already exist here*; "home" matches a word glossed "home, world".
- New Human words (`human-vocab-extra.txt`): west, home, raider, east, south, north, farm (garðr), kingdom (ríki).

## v0.20.0
- Dictionary: a line above the table shows which languages this one inherits words from and how many words each contributes ("Inherits words from Drow (12) ← High (80) ← Elven (540)"). If the language tree stops words from reaching it, a warning says which language is the problem: a language with no split year, or one that splits earlier than the language it splits from. A word only passes down through every language between its own and the branch if each split year is the same as or later than the one above it.

## v0.19.0
- Dictionary: a filter box under each of ID, Gloss, Type, Build, Year and Form (all combine). ID accepts several ids separated by commas or spaces; Year accepts a number, a range `-8000..-5000`, or `<-5000` / `>0`. "Clear filters" resets them and the general search.
