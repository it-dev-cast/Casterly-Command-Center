const CASTERLY_PURPLE = "#524A9D";
const CASTERLY_PURPLE_ON_DARK = "#D4CFF0";

export function CasterlyMark({ size = 28, className }) {
  return (
    <img
      src="/casterly-mark.png"
      alt=""
      width={size}
      height={size}
      className={className}
      aria-hidden
      draggable={false}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}

function wordmarkStyle(variant, fontSize) {
  return {
    fontWeight: 800,
    fontSize,
    letterSpacing: 0.55,
    color: variant === "dark" ? CASTERLY_PURPLE_ON_DARK : CASTERLY_PURPLE,
    lineHeight: 1,
    textTransform: "uppercase",
    fontFamily: "Inter, Outfit, -apple-system, sans-serif",
    whiteSpace: "nowrap",
  };
}

export function CasterlyLogo({
  variant = "light",
  layout = "stacked",
  width = 44,
  className,
}) {
  if (layout === "lockup") {
    return (
      <img
        src="/casterly-logo.png"
        alt="CASTERLY"
        className={className}
        style={{ width, height: "auto", objectFit: "contain", display: "block" }}
        draggable={false}
      />
    );
  }

  if (layout === "inline") {
    const mark = Math.max(14, Math.round(width * 0.36));
    return (
      <div className={className} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <CasterlyMark size={mark} />
        <span style={wordmarkStyle(variant, Math.max(10, Math.round(mark * 0.72)))}>CASTERLY</span>
      </div>
    );
  }

  const fontSize = Math.max(8, Math.round(width * 0.2));
  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: 4 }}
    >
      <img
        src="/casterly-mark.png"
        alt=""
        aria-hidden
        draggable={false}
        style={{ width, height: width, objectFit: "contain", display: "block" }}
      />
      <span style={{ ...wordmarkStyle(variant, fontSize), textAlign: "center" }}>CASTERLY</span>
    </div>
  );
}
