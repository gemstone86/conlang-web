# Root and Rune

Multi-user web app for building constructed languages: language families with split years, a dictionary,
dated sound-change rules that evolve every word down the family tree automatically (with locked overrides),
automatic compound erosion, sharing with owner approval, undo/redo and Excel export.

Spring Boot 3.3 · Java 21 · Maven · embedded H2 2.3.232 (single file) via JDBC · plain-JS front end.
Same layout as the weather generator.

## Running it

    mvn spring-boot:run          (or run.bat / run.ps1)
    open http://localhost:8081

The first account you register becomes the admin. The database is `./data/conlangs.mv.db`.
To build one jar: `mvn package`, then `java -jar target/root-and-rune.jar`.

### Eclipse
1. File → Import → Maven → Existing Maven Projects → pick this folder.
2. If you see red errors: right-click the project → Maven → Update Project (tick Force Update).
3. Run `com.conlangs.web.ConlangApplication` as a Java Application, then open http://localhost:8081.

Configuration (environment variables): `CONLANG_DB_URL` (keep `;NON_KEYWORDS=YEAR` in the URL),
`CONLANG_DB_USER`, `CONLANG_DB_PASSWORD`, `CONLANG_REGISTRATION=false` to close registration,
`CONLANG_SECURE_COOKIE=true` behind HTTPS. Docker: `docker compose up --build`.

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
* **One-time import**: as admin, `POST /api/admin/import-elven` (multipart `file`, `languageId`) reads the sheet
  "Ygg Elven dict" and imports root/derived/phrase rows. It skips "shifted"/"indexed" rows (regenerated from rules).

* **Grammar tab**: tables of rules (word order, tenses, affixes, prepositions...) grouped in sections, each section with its
  own column headings. Add, edit and delete rows and sections; changes follow the same approval and undo rules as the dictionary.
* **Sounds tab**: consonant and vowel grids. Give a sound a "from" / "until" year and the grid changes with the year you choose.
  (The years are entered by hand; they are not yet derived from the sound-change rules.)
* **One-time grammar import**: as admin, `POST /api/admin/import-grammar` (multipart `file`, `languageId`, optional `replace=true`)
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
`mvn test` runs `EvolverTest` (family-tree inheritance, splits, overrides, bad regexes, erosion collision stop).

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

## v0.18.3
- Dictionary search also finds reference words: search "see", "reference", or the name of the word they point to.

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
