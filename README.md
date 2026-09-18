# dev-agent-workflow — plugin Claude Code

Plugin Claude Code prowadzący od analizy zadania do przetestowanych, zrecenzowanych zmian
zatwierdzonych lokalnym commitem na gałęzi zadania. Zakres kontroli zależy od ryzyka zadania:
sesja główna (orchestrator) planuje, klasyfikuje ryzyko i deleguje pracę wyspecjalizowanym
subagentom; trywialne zmiany niskiego ryzyka wykonuje sama. Komunikacja z użytkownikiem jest po
polsku, materiały robocze po angielsku.

To repozytorium jest jednocześnie **pluginem** (`.claude-plugin/plugin.json`) i **marketplace**
`jared0o-plugins` (`.claude-plugin/marketplace.json`). Jest portem pluginu Codex CLI
[dev-agent-workflow](https://github.com/Jared0o/dev-agent-workflow) dostosowanym do Claude Code:
natywne subagenty, hooki egzekwujące reguły, helper stanu w Node, evale.

## Instalacja

Wymagania: Claude Code z pluginami, subagentami i hookami (przygotowane dla `2.1.274`),
Node.js 20+ (testowane na 22), Git. Na Windows Bash w Claude Code to Git Bash
(`CLAUDE_CODE_GIT_BASH_PATH`). `gh` jest potrzebne tylko dla opcjonalnego trybu `draft-pr`.
Plugin nie wymaga klucza API ani Pythona.

Z GitHuba (dowolna maszyna):

```sh
claude plugin marketplace add Jared0o/claude-dev-agent-workflow
claude plugin install dev-agent-workflow@jared0o-plugins
```

Z lokalnego klonu:

```powershell
pwsh .\scripts\install.ps1            # Windows: marketplace add <to repo> + plugin install
```

```sh
scripts/install.sh                    # Linux / macOS
```

Plugin z marketplace jest **kopiowany** do `~/.claude/plugins/cache/jared0o-plugins/dev-agent-workflow/<wersja>`.
Po zmianach w repozytorium podbij `version` w `.claude-plugin/plugin.json` i `package.json`, potem
`pwsh .\scripts\update.ps1`. Praca na żywo bez kopiowania: `pwsh .\scripts\dev.ps1` (czyli
`claude --plugin-dir <to repo>`), zmiany widoczne po `/reload-plugins`. Nie łącz obu sposobów
w jednej sesji.

Uruchom sesję w katalogu aplikacji (najlepiej `claude --permission-mode auto` albo Shift+Tab do
trybu auto, żeby subagenci nie zatrzymywali się na promptach uprawnień) i wpisz:

```text
/dev-agent-workflow:dev-workflow Dodaj logowanie do aplikacji Go + Next.js. Najpierw przygotuj analizę.
/dev-agent-workflow:dev-workflow list
/dev-agent-workflow:dev-workflow status add-login
/dev-agent-workflow:dev-workflow resume add-login
/dev-agent-workflow:dev-workflow abort add-login
```

Skill uruchamia się wyłącznie jawnie (`disable-model-invocation: true`), więc plugin
zainstalowany globalnie nie tworzy niespodziewanie katalogów `.dev-workflow/` ani gałęzi w
innych repozytoriach. Jeśli wolisz automatyczne wywoływanie, usuń tę linię z
`skills/dev-workflow/SKILL.md` w swoim forku.

## Przebieg

Nowe zadania: **krótki plan → implementacja z testami i dokumentacją → weryfikacja → lokalny
commit**. Orchestrator zapisuje poziom ryzyka i uzasadnienie; plan `standard`/`high` wymaga
akceptacji przez `AskUserQuestion`, zanim helper zapisze `approve --confirmed-by-user`.

| Ryzyko | Przykłady | Akceptacja i kontrola |
|---|---|---|
| Niskie (`low`) | Zwykły tekst dokumentacji, kosmetyka UI, jednoznaczna lokalna poprawka bez wpływu na bezpieczeństwo, trwałe dane i kontrakty | Jasne zlecenie wystarcza; trywialne zmiany (`direct-low`) wykonuje i sprawdza orchestrator, pozostałe deleguje implementerowi i ocenia wynik |
| Standardowe (`standard`, domyślne) | Pozostałe zadania bez przesłanek wysokiego ryzyka | Akceptacja planu, implementer i niezależny reviewer |
| Wysokie (`high`) | Logowanie, uprawnienia, płatności, migracje, operacje destrukcyjne, zgodność publicznego API | Akceptacja planu, implementer, niezależny tester i reviewer wysokiego ryzyka |

Dla jednego zadania implementacyjnego oznacza to **0 pomocników dla trywialnego `low`, 1 dla
pozostałego `low`, 2 dla `standard` i 3 dla `high`**, bez orchestratora i rund napraw. Liczba
plików nie wyznacza ryzyka. Prośba o samą analizę nie upoważnia do implementacji.

| Rola | Agent | Model | Effort |
|---|---|---|---|
| Orchestrator (sesja główna) | — | model Twojej sesji | Twojej sesji |
| Implementer (kod + testy + dokumentacja) | `implementer` | Opus 5 | high |
| Tester (tylko `high`) | `tester` | Sonnet 5 | medium |
| Reviewer (`standard`) | `reviewer` | Opus 5 | medium |
| Reviewer (`high`) | `reviewer-high` | Fable 5.1 | xhigh |
| Diagnoza (po wyczerpaniu zwykłych napraw) | `diagnosis` | Fable 5.1 | xhigh |

Każdy subagent startuje ze świeżym kontekstem i dostaje pakiet zadania (ścieżki, cele, kryteria,
komendy sprawdzające), nie historię sesji. Odpowiada jednym blokiem JSON z ID handoffu
(`impl-1`, `rev-1`, ...), który trafia do raportu weryfikacji. Domyślnie dopuszczone są dwie
rundy naprawy problemu i jedna próba po diagnozie; diagnoza nie zwiększa budżetu napraw.

Profile technologiczne obejmują Go, C#/.NET i React/Next.js
(`skills/dev-workflow/references/profiles/`). Korzystają z narzędzi i wersji zastanego projektu i
czytają najpierw jego `CLAUDE.md`, `.claude/rules/` i `AGENTS.md`. Tylko orchestrator wykonuje
operacje Git.

## Konfiguracja i stan

Domyślne ustawienia są w [config/defaults.json](config/defaults.json). Opcjonalny plik aplikacji
`.dev-workflow/config.json` zawiera tylko nadpisania (nieznane pola są odrzucane):

```json
{
  "max_parallel_agents": 2,
  "models": {
    "implementer": { "agent": "implementer", "model": "sonnet" }
  },
  "risk_model_overrides": {
    "high": { "reviewer": { "agent": "reviewer-high", "model": "opus" } }
  },
  "delivery": "local"
}
```

`model` to alias Claude Code (`sonnet|opus|haiku|fable`) przekazywany do narzędzia Agent, albo
`null` (model z definicji agenta). **Effort jest ustalony w definicji agenta** (`agents/*.md`),
bo narzędzie Agent nie pozwala go nadpisać przy wywołaniu; nadpisanie `model` zmienia tylko model.
Inny effort wymaga własnej kopii agenta. Zmiana efektywnej konfiguracji w trakcie zadania
unieważnia akceptację planu.

`.dev-workflow/tasks/<id>/` przechowuje `state.json` (etap, ryzyko, tryb, akceptacja, dowody,
budżet napraw), `spec.md`, `tasks.json`, `reports/verification.json`, `delivery.json`,
`agents.jsonl` (ID subagentów zapisane przez hook) i `logs/`. Marker `.dev-workflow/active-task`
wskazuje jedno aktywne zadanie w repozytorium. Helper `init` dopisuje `.dev-workflow/` do
`.git/info/exclude`, więc artefakty nie trafiają do commitów ani do `git status`. Stan pozwala
wznowić pracę w nowej sesji: zmiany repozytorium i raporty są porównywane przez SHA-256.

Hooki pluginu (`hooks/hooks.json`):

- `PreToolUse` — **guard**: gdy zadanie jest aktywne, subagenci nie mogą wykonywać zapisujących
  komend Git (`commit`, `push`, `add`, `stash`, `checkout`, `reset`, ...), mutujących komend
  helpera ani edytować `.dev-workflow/` (poza `tasks/<id>/logs/`). Sesja główna nie ma ograniczeń.
- `SessionStart` (`startup|resume|compact`) — przypomnienie o aktywnym zadaniu, jego etapie i
  komendzie wznowienia; po kompaktowaniu kontekstu nakazuje odczyt stanu przed działaniem.
- `SubagentStop` — dopisuje ID i typ zakończonego subagenta do `agents.jsonl` jako dowód pomocniczy.

Format komend helpera i raportu opisuje
[skills/dev-workflow/references/state.md](skills/dev-workflow/references/state.md). Helper jest
lokalnym narzędziem walidacji, nie silnikiem uruchamiającym modele: nie potwierdza, że człowiek
zaakceptował plan ani że test wykonano — orchestrator musi zapisywać rzeczywiste wyniki.

## Oszczędność i jakość

Subagenci otrzymują krótkie pakiety i ścieżki do plików zamiast pełnej historii. Testy
wykonują narzędzia projektu, a model ocenia wyniki i sensowność scenariuszy. Reviewer korzysta z
aktualnych dowodów implementera; tester wysokiego ryzyka koncentruje się na scenariuszach i
integracjach wymagających niezależnego sprawdzenia; nowy agent nie oznacza powtórzenia całej
suity. Brak narzędzia nie oznacza wyniku pozytywnego (`not-run` blokuje zakończenie).
Wymagane oceny i komendy z planu blokują dostarczenie, jeśli nie zostały wykonane lub wykryły
nierozwiązany problem. Podsumowanie podaje skonfigurowane modele pomocników i liczbę agentów oraz
prób; plugin nie obiecuje procentowej oszczędności tokenów.

## Git i dostarczenie

Domyślny rezultat (`delivery: local`) to commit zrecenzowanych plików na gałęzi
`feature/<id>` — bez push, PR, merge i wdrożenia. Odpowiedź końcowa podaje komendę
`git push -u origin feature/<id>` i miejsce otwarcia PR. Tryb `delivery: draft-pr` (w
`.dev-workflow/config.json`) dodatkowo pushuje gałąź i tworzy draft PR przez `gh`
(`winget install GitHub.cli`, `gh auth login`); gdy `gh` nie działa, commit zostaje lokalnie,
zadanie w etapie `delivery`, a odpowiedź podaje link compare do ręcznego PR. Plugin nigdy nie
zmienia widoczności repozytorium, nie robi force push ani nie wraca do publicznego repozytorium.

## Zalecane uprawnienia w projekcie

W trybie auto agenci działają bez promptów. W trybie domyślnym pomocne są reguły w
`.claude/settings.json` projektu (lub przez `/permissions`):

```json
{
  "permissions": {
    "allow": [
      "Bash(node *)",
      "Bash(dotnet build*)", "Bash(dotnet test*)",
      "Bash(npm test*)", "Bash(npm run*)",
      "Bash(go test*)", "Bash(go vet*)", "Bash(go build*)",
      "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(git show*)", "Bash(git rev-parse*)", "Bash(git ls-files*)"
    ]
  }
}
```

## Weryfikacja pluginu

```sh
npm run check        # składnia hooków i skryptów
npm run validate     # struktura pluginu, marketplace, konfiguracja, frontmatter, linki
npm test             # helper, hooki i walidator na tymczasowych repozytoriach Git
claude plugin validate . --strict
claude plugin eval .                     # opcjonalnie; uruchamia realne sesje (koszt tokenów)
```

Testy są lokalne (Node 20+, Git), nie uruchamiają modeli i nie publikują nic do GitHuba. CI
(GitHub Actions, ubuntu + windows) wykonuje `check`, `validate` i `test`. Walidacja struktury nie
zastępuje oceny zachowania agentów: scenariusze do prób ręcznych są w
[docs/scenarios.md](docs/scenarios.md), a przypadki `claude plugin eval` w [evals/](evals/README.md).
Evale potrzebują grantu `--allow-tools Bash Write Edit` i `--scaffold` (fixture tworzy repozytorium
Git); komendy shell działają wtedy w sandboxie Claude Code, którego natywny Windows nie ma — uruchamiaj
je z WSL2, Linuxa albo macOS. `claude plugin validate hooks/hooks.json` zgłasza błąd, bo CLI traktuje
ten plik jak manifest; strukturę hooków sprawdza `npm run validate`.

## Publikacja na GitHub

```sh
git remote add origin https://github.com/Jared0o/claude-dev-agent-workflow.git
git push -u origin main
git tag v0.1.0 && git push origin v0.1.0
```

Wersjonowanie: SemVer w `.claude-plugin/plugin.json` i `package.json` oraz tagi `v0.1.0`,
`v0.2.0` itd. Po opublikowaniu wydania użytkownicy aktualizują przez
`claude plugin marketplace update jared0o-plugins` i `claude plugin update dev-agent-workflow@jared0o-plugins`.

## Rozwiązywanie problemów

- **„Another task is active: ...”** — w repozytorium jest niezakończone zadanie; użyj
  `resume <id>` albo `abort <id>`. Zakończone/przerwane zadanie zwalnia marker automatycznie.
- **Hook zablokował komendę Git** — dotyczy tylko subagentów podczas aktywnego zadania; sesja
  główna commituje normalnie. Subagent powinien zwrócić wynik orchestratorowi.
- **Skill nie ładuje się na Windows** — linie `` !`...` `` w `SKILL.md` wymagają Git Bash jako
  shella Bash w Claude Code (`CLAUDE_CODE_GIT_BASH_PATH`).
- **Limit modelu Fable/Opus** — nadpisz `model` roli w `.dev-workflow/config.json`
  (np. `"reviewer": {"agent": "reviewer-high", "model": "opus"}`); effort pozostaje z definicji
  agenta. Zmiana konfiguracji wymaga ponownej akceptacji planu.
- **Agent stoi na prompt o uprawnienia** — dodaj regułę z sekcji „Zalecane uprawnienia” albo
  uruchom sesję w trybie auto.
- **Stan z pluginu Codex** — katalogi `.dev-workflow/tasks/*` ze `schema_version` 1 lub 2 są
  odrzucane z komunikatem; ten plugin obsługuje tylko `schema_version` 3.
- **„Plan/config changed or is unapproved”** — zmieniono `spec.md`, `tasks.json` albo
  konfigurację po akceptacji; przedstaw zmianę użytkownikowi i zapisz `approve` ponownie.

## Licencja

MIT.
