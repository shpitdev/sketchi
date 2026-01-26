# venom CI/CD (one-time)

delete after CI/CD working + example tests in `tests/api`

install options
- binary from GitHub releases
- docker image `ovhcom/venom:latest`

baseline pipeline
- fetch venom (binary or docker)
- run tests with explicit glob: `venom run tests/api/**/*.yml`
- set `IS_TTY=true` (proper output in CI)
- use `--format=xml --output-dir=dist/venom` for xUnit/JUnit viewers
- optional `--html-report` (HTML in output dir)
- collect artifacts: XML, HTML, `venom.log`

CI knobs
- colors off: `NO_COLOR=1`
- verbosity: `-v`, `-vv`, `-vvv` or `VENOM_VERBOSE=1|2|3`
- stop early: `--stop-on-failure` or `VENOM_STOP_ON_FAILURE=true`
- vars: `--var key=value`, `--var-from-file vars.yml`, `VENOM_VAR_key=value`
- custom executors: `--lib-dir lib/` (mount in CI if docker)
