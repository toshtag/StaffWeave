/**
 * 横に送れる表。
 *
 * 列の多い表は、狭い画面に収まらない。収まらないぶんを画面ごと横へ広げると、
 * 本文を読むたびに横へ戻すことになる。表だけを横に送れるようにする。
 *
 * 送れる領域には焦点を置ける必要がある。置けないと、キーボードだけでは送れず、
 * 画面の外にある列を読む手段が無くなる。焦点を置ける領域には名前も要る。
 * 無いと、読み上げが「何の領域か」を言えない。
 */
export function ScrollableTable({
  label,
  children,
}: {
  /** 読み上げで領域を指すための名前。表の見出しと同じにする。 */
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: 横に送れる領域は、焦点を置けないとキーボードだけでは送れない
    <section className="table-scroll" tabIndex={0} aria-label={label}>
      <table>{children}</table>
    </section>
  );
}
