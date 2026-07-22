#!/bin/sh

fail() {
  printf 'sketchi install: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -n "${temporary_completion_file:-}" ]; then
    rm -f "$temporary_completion_file" || :
    temporary_completion_file=
  fi
  if [ -n "${temporary_rc_file:-}" ]; then
    rm -f "$temporary_rc_file" || :
    temporary_rc_file=
  fi
}

exit_for_signal() {
  signal_status=$1
  cleanup
  trap - 0 1 2 3 15
  exit "$signal_status"
}

main() {
  set -eu

  if ! command -v npm >/dev/null 2>&1; then
    fail "npm is required. Install Node.js 24.13.0 or newer, then rerun this script."
  fi

  # This override exists only so isolated verification can install a local tarball.
  if [ "${SKETCHI_INSTALL_PACKAGE+x}" = x ]; then
    package_spec=$SKETCHI_INSTALL_PACKAGE
    case $package_spec in
      -* | "")
        fail "SKETCHI_INSTALL_PACKAGE must point to an existing local .tgz archive."
        ;;
      *.tgz) ;;
      *)
        fail "SKETCHI_INSTALL_PACKAGE must point to an existing local .tgz archive."
        ;;
    esac
    if [ ! -f "$package_spec" ]; then
      fail "SKETCHI_INSTALL_PACKAGE must point to an existing local .tgz archive."
    fi
    case $package_spec in
      /*) ;;
      *)
        package_name=$(basename "$package_spec")
        package_directory=$(dirname "$package_spec")
        if ! package_directory=$(CDPATH= cd "$package_directory" && pwd -P); then
          fail "could not resolve SKETCHI_INSTALL_PACKAGE."
        fi
        package_spec=$package_directory/$package_name
        ;;
    esac
  else
    package_spec=sketchi
  fi

  npm install -g "$package_spec"
  if ! command -v sketchi >/dev/null 2>&1; then
    fail "npm installed sketchi, but the sketchi command is not available on PATH."
  fi

  shell_path=${SHELL:-}
  shell_name=${shell_path##*/}
  case $shell_name in
    zsh)
      rc_file=${ZDOTDIR:-$HOME}/.zshrc
      source_block='autoload -Uz compinit
(( ${+functions[compdef]} )) || compinit
source "$HOME/.sketchi/completions/sketchi.zsh"'
      ;;
    bash)
      rc_file=$HOME/.bashrc
      source_block='case ${BASH_VERSION:-} in
  [4-9].* | [1-9][0-9]*.*) source "$HOME/.sketchi/completions/sketchi.bash" ;;
esac'
      ;;
    fish)
      rc_file=${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish
      source_block='source "$HOME/.sketchi/completions/sketchi.fish"'
      ;;
    *)
      detected_shell=${shell_name:-unknown}
      printf 'Installed sketchi globally.\n'
      printf 'Completions skipped: supported shells are zsh, bash, and fish (detected %s).\n' "$detected_shell"
      exit 0
      ;;
  esac

  completion_directory=$HOME/.sketchi/completions
  completion_file=$completion_directory/sketchi.$shell_name
  begin_marker='# BEGIN sketchi completions'
  end_marker='# END sketchi completions'

  mkdir -p "$completion_directory" "$(dirname "$rc_file")"

  rc_target_file=$rc_file
  symlink_count=0
  while [ -L "$rc_target_file" ]; do
    symlink_count=$((symlink_count + 1))
    if [ "$symlink_count" -gt 40 ]; then
      fail "could not resolve $rc_file safely: symlink chain exceeds 40 links."
    fi
    if ! link_target=$(readlink "$rc_target_file"); then
      fail "could not resolve symlink $rc_target_file."
    fi
    case $link_target in
      /*) rc_target_file=$link_target ;;
      *) rc_target_file=$(dirname "$rc_target_file")/$link_target ;;
    esac
  done
  mkdir -p "$(dirname "$rc_target_file")"

  temporary_completion_file=$completion_file.sketchi.$$
  temporary_rc_file=
  trap cleanup 0
  trap 'exit_for_signal 129' 1
  trap 'exit_for_signal 130' 2
  trap 'exit_for_signal 131' 3
  trap 'exit_for_signal 143' 15

  if ! (umask 077 && set -C && : >"$temporary_completion_file") 2>/dev/null; then
    fail "could not create a temporary completion file."
  fi
  if ! sketchi --completions "$shell_name" >"$temporary_completion_file"; then
    fail "could not generate $shell_name completions."
  fi
  if [ ! -s "$temporary_completion_file" ]; then
    fail "sketchi generated an empty $shell_name completion script."
  fi
  if ! mv -f "$temporary_completion_file" "$completion_file"; then
    fail "could not install $shell_name completions."
  fi
  temporary_completion_file=

  temporary_rc_file=$rc_target_file.sketchi.$$
  if ! (umask 077 && set -C && : >"$temporary_rc_file") 2>/dev/null; then
    fail "could not create a temporary shell configuration file."
  fi
  if [ -e "$rc_target_file" ]; then
    if ! cp -p "$rc_target_file" "$temporary_rc_file"; then
      fail "could not preserve $rc_file permissions."
    fi
    rc_input=$rc_target_file
  else
    rc_input=/dev/null
  fi
  if ! awk -v begin="$begin_marker" -v end="$end_marker" '
  $0 == begin {
    if (in_block) exit 2
    in_block = 1
    next
  }
  $0 == end {
    if (!in_block) exit 2
    in_block = 0
    next
  }
  !in_block { print }
  END { if (in_block) exit 2 }
' "$rc_input" >"$temporary_rc_file"; then
    fail "found an incomplete sketchi completion block in $rc_file."
  fi
  if ! printf '%s\n%s\n%s\n' "$begin_marker" "$source_block" "$end_marker" >>"$temporary_rc_file"; then
    fail "could not update $rc_file."
  fi
  if ! mv -f "$temporary_rc_file" "$rc_target_file"; then
    fail "could not atomically replace $rc_file."
  fi
  temporary_rc_file=
  trap - 0 1 2 3 15

  printf 'Installed sketchi globally.\n'
  printf 'Installed %s completions in %s.\n' "$shell_name" "$completion_file"
  printf 'Updated %s with one sketchi source block.\n' "$rc_file"
}

main "$@"
