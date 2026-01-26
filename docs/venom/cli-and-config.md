# cli + config

commands
- `venom` / `venom help` / `venom -h`
- `venom run [files|paths|glob]`
- `venom update`
- `venom version`

run flags
- `-f, --format` output format: `xml` (default), `json`, `yml`, `tap`
- `--html-report` write HTML report (uses `--output-dir`)
- `--lib-dir` custom executor dir
- `-o, --output-dir` results directory
- `--stop-on-failure` stop after first failure
- `--var key=value` pass variable (repeatable)
- `--var-from-file path.yml` load variables from YAML dictionary file
- `-v/-vv/-vvv` verbosity levels (1/2/3)

config file
- `.venomrc` (YAML)
- keys: `format`, `lib-dir`, `output-dir`, `stop-on-failure`, `verbose`, `var`, `var-from-file`
- precedence: cli flags > `.venomrc` > env vars

env vars
- `VENOM_FORMAT`
- `VENOM_LIB_DIR` (comma-separated)
- `VENOM_OUTPUT_DIR`
- `VENOM_STOP_ON_FAILURE`
- `VENOM_VERBOSE` (1/2/3)
- `VENOM_VAR_key=value`
- `VENOM_VAR_FROM_FILE`
- `NO_COLOR=1` disable colors
- `IS_TTY=true` force tty (CI)

run selection
- `venom run` runs all `*.yml|*.yaml` in current dir
- globstar supported: `venom run tests/api/**/*.yml`
- file order = order of args (control with `find | sort` if needed)

install
- `brew install venom`
- `brew upgrade venom`
- `go install github.com/ovh/venom/cmd/venom@latest`
- `docker run --rm -v $(pwd):/workdir -w /workdir ovhcom/venom:latest run`
