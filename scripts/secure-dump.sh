# バックアップを所有者だけが読める権限で、原子的に作る。
#
#   . "$(dirname "$0")/secure-dump.sh"
#   secure_dump "$OUTPUT" "$CONTAINER" "$USER_NAME" "$DATABASE"
#
# 出力には業務データ、パスワードハッシュ、セッションと API キーのハッシュ、
# Webhook の署名鍵が含まれる。umask 022 の一般的な環境では、素朴に書くと
# ディレクトリが 0755、ファイルが 0644 になり、同じホストの他の利用者から読める。
#
# 出力先へ直接書くと、途中で失敗したときに不完全なファイルが最終名で残る。
# 同じディレクトリの一時ファイルへ書いてから置き換える。

# 権限のビットを 8 進数で返す。読めない環境では空文字を返す。
# GNU と BSD で書式が違うため、両方を試す。
_file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || printf ''
}

# 所有者以外へ与えている権限があれば 1 を返す。読めない場合は 0 とする。
_is_shared() {
  mode=$(_file_mode "$1")
  [ -n "$mode" ] || return 1
  # 下 2 桁がグループとその他。どちらかが 0 でなければ共有されている。
  case "$mode" in
    *00) return 1 ;;
    *) return 0 ;;
  esac
}

secure_dump() {
  output=$1
  container=$2
  user_name=$3
  database=$4

  # 作成するものはすべて所有者だけが読める権限にする。
  umask 077

  directory=$(dirname "$output")
  mkdir -p -m 700 "$directory"
  if _is_shared "$directory"; then
    echo "保存先が所有者以外から読める権限です: $directory" >&2
    echo "chmod 700 で直してから、もう一度実行してください。" >&2
    return 1
  fi

  # シンボリックリンクの参照先へ書くと、意図しない場所へ業務データを出せる。
  if [ -L "$output" ]; then
    echo "保存先がシンボリックリンクです: $output" >&2
    return 1
  fi
  if [ -e "$output" ] && [ ! -f "$output" ]; then
    echo "保存先が通常のファイルではありません: $output" >&2
    return 1
  fi

  temporary="$directory/.$(basename "$output").tmp.$$"
  # 失敗したまま抜けても、書きかけを残さない。
  trap 'rm -f "$temporary"' EXIT INT TERM

  if ! docker exec "$container" pg_dump \
    --username "$user_name" --format=custom "$database" > "$temporary"; then
    rm -f "$temporary"
    trap - EXIT INT TERM
    echo "バックアップを作成できませんでした。" >&2
    return 1
  fi

  chmod 600 "$temporary"
  mv "$temporary" "$output"
  trap - EXIT INT TERM

  # 置き換え先が既存ファイルでも、権限は一時ファイルのものが残る。念のため確定させる。
  chmod 600 "$output"
  if _is_shared "$output"; then
    echo "バックアップの権限を狭められませんでした: $output" >&2
    return 1
  fi
}
