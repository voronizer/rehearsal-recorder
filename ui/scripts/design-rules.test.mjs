import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { checkText, judge, missingStories, partsToCheck, RULES } from "./design-rules.mjs"

const SCREEN = "ui/src/screens/Example.tsx"
const SHARED = "ui/src/components/ui/example.tsx"

// The rules a piece of source breaks, as names, in the order they were found.
const broken = (text, path = SCREEN) => checkText(path, text).map((f) => f.rule)
// The same, for a className made of the given classes.
const classes = (list, path = SCREEN) => broken(`<div className="${list}" />`, path)
// Source over several lines.
const lines = (...list) => list.join("\n")

describe("the rule list", () => {
  it("names the fifteen rules the design check knows", () => {
    expect(RULES.map((r) => r.name)).toEqual([
      "px-text",
      "text-size",
      "raw-colour",
      "radius",
      "uppercase",
      "raw-button",
      "radix",
      "dialog",
      "raw-field",
      "raw-label",
      "spinner",
      "native-tip",
      "pressed-button",
      "card",
      "story",
    ])
  })

  it("gives every rule its reason", () => {
    for (const rule of RULES) expect(rule.why, rule.name).toMatch(/\w/)
  })
})

describe("px-text", () => {
  it("catches a pixel size in brackets, on any variant", () => {
    expect(classes("text-[11px]")).toEqual(["px-text"])
    expect(classes("md:hover:text-[10.5px] flex")).toEqual(["px-text"])
  })

  it("catches a fontSize in a style", () => {
    expect(broken(`<p style={{ fontSize: 12 }} />`)).toEqual(["px-text"])
    expect(broken(`<p style={{ fontSize: "clamp(1rem, 8cqi, 2rem)" }} />`)).toEqual(["px-text"])
  })

  it("catches a fontSize given a value in any style object", () => {
    expect(broken(`<p style={{ fontSize: CLOCK_SIZE }} />`)).toEqual(["px-text"])
    expect(broken("<p style={{ fontSize: `calc(${size} / 2)` }} />")).toEqual(["px-text"])
    expect(broken(`const look: CSSProperties = { width: 1, fontSize: 14 }`)).toEqual(["px-text"])
    expect(broken(`<p style="font-size: 12px" />`)).toEqual(["px-text"])
  })

  it("catches the shorthand property, on one line or several", () => {
    expect(broken(`<p style={{ fontSize }} />`)).toEqual(["px-text"])
    expect(broken(`<p style={{ color: "inherit", fontSize }} />`)).toEqual(["px-text"])
    const text = [`<p`, `  style={{`, `    width: 1,`, `    fontSize,`, `  }}`, `/>`].join("\n")
    expect(checkText(SCREEN, text)).toEqual([{ rule: "px-text", line: 4, text: "fontSize" }])
    expect(broken(`const style = { fontSize }`)).toEqual(["px-text"])
  })

  it("leaves a type annotation alone", () => {
    expect(broken(`type Props = { fontSize: number }`)).toEqual([])
    expect(broken(`type Props = { fontSize?: number; width: string }`)).toEqual([])
    expect(broken(`type Props = { fontSize: string | number }`)).toEqual([])
    expect(broken([`interface Props {`, `  fontSize: number`, `}`].join("\n"))).toEqual([])
    expect(broken(`function Box(props: { fontSize: number }) {}`)).toEqual([])
  })

  it("leaves a read of a variable called fontSize alone", () => {
    expect(broken(`const size = open ? fontSize : 12`)).toEqual([])
    expect(broken(`const size = props.fontSize`)).toEqual([])
    expect(broken(`setFontSize(fontSize)`)).toEqual([])
    expect(broken(`const { fontSize } = props`)).toEqual([])
    expect(broken(`const { color, fontSize } = props`)).toEqual([])
    expect(broken(`function Box({ fontSize }: Props) {}`)).toEqual([])
    expect(broken(`const Box = ({ fontSize, color }: Props) => null`)).toEqual([])
    expect(broken([`const {`, `  color,`, `  fontSize,`, `} = props`].join("\n"))).toEqual([])
    expect(broken([`function Box({`, `  fontSize,`, `  color,`, `}: Props) {}`].join("\n"))).toEqual([])
  })

  it("lets the named sizes through, and padding that merely ends in px", () => {
    expect(classes("px-3 py-2 text-sm")).toEqual([])
    expect(classes("text-xs text-base text-[var(--clock)]")).toEqual([])
  })
})

describe("text-size", () => {
  it("catches text-lg and everything from text-3xl up", () => {
    expect(classes("text-lg")).toEqual(["text-size"])
    expect(classes("sm:text-3xl")).toEqual(["text-size"])
    expect(classes("text-4xl text-9xl")).toEqual(["text-size", "text-size"])
  })

  it("catches a size given in rem or em", () => {
    expect(classes("text-[1.25rem]")).toEqual(["text-size"])
    expect(classes("text-[2em]")).toEqual(["text-size"])
  })

  it("looks at the size, not at a line height after it", () => {
    expect(classes("text-sm/6 text-xs/5 text-2xl/8")).toEqual([])
    expect(classes("text-lg/6")).toEqual(["text-size"])
  })

  it("lets the five sizes through, and other text- classes", () => {
    expect(classes("text-xs text-sm text-base text-xl text-2xl")).toEqual([])
    expect(classes("text-left text-foreground text-muted-foreground text-balance")).toEqual([])
    expect(classes("text-large")).toEqual([])
  })
})

describe("raw-colour", () => {
  it("catches a palette colour with a shade after a colour utility", () => {
    expect(classes("bg-red-500")).toEqual(["raw-colour"])
    expect(classes("border-zinc-200 text-amber-600")).toEqual(["raw-colour", "raw-colour"])
    expect(classes("dark:hover:bg-slate-900/50")).toEqual(["raw-colour"])
    expect(classes("ring-offset-neutral-950")).toEqual(["raw-colour"])
    expect(classes("from-sky-400 via-indigo-500 to-pink-600")).toEqual(["raw-colour", "raw-colour", "raw-colour"])
  })

  it("catches white and black, with or without an opacity", () => {
    expect(classes("text-white")).toEqual(["raw-colour"])
    expect(classes("bg-black/60")).toEqual(["raw-colour"])
    expect(classes("shadow-white fill-black stroke-white")).toEqual(["raw-colour", "raw-colour", "raw-colour"])
  })

  it("catches an arbitrary colour in brackets", () => {
    expect(classes("bg-[#1a1a1a]")).toEqual(["raw-colour"])
    expect(classes("text-[rgb(10,20,30)]")).toEqual(["raw-colour"])
    expect(classes("border-[hsl(210_40%_96%)]")).toEqual(["raw-colour"])
    expect(classes("fill-[oklch(0.5_0.2_30)]")).toEqual(["raw-colour"])
  })

  it("catches a colour after an underscore, which is a space in an arbitrary value", () => {
    expect(classes("shadow-[0_0_0_1px_#fff]")).toEqual(["raw-colour"])
    expect(classes("border-[1px_solid_#fff]")).toEqual(["raw-colour"])
    expect(classes("shadow-[0_1px_2px_rgba(0,0,0,.2)]")).toEqual(["raw-colour"])
    expect(classes("bg-[linear-gradient(to_right,_#fff,_hsl(0_0%_0%))]")).toEqual(["raw-colour", "raw-colour"])
  })

  it("catches a hex written as a whole string value, or after a CSS property", () => {
    expect(broken(`const stroke = "#1a1a1a"`)).toEqual(["raw-colour"])
    expect(broken(`ctx.fillStyle = '#fff'`)).toEqual(["raw-colour"])
    expect(broken(`const look = { color: "#1a1a1a" }`)).toEqual(["raw-colour"])
    expect(broken(`<i style={{ color: "#fff" }} />`)).toEqual(["raw-colour"])
    expect(broken(`<circle fill="#fff" />`)).toEqual(["raw-colour"])
    expect(broken("const c = `#fff`")).toEqual(["raw-colour"])
    expect(broken(`const css = "border: 1px solid #fff"`)).toEqual(["raw-colour"])
    expect(broken(`const css = "color: red; background: #fff"`)).toEqual(["raw-colour"])
    expect(broken(`const css = "background: linear-gradient(#fff, #000)"`)).toEqual(["raw-colour", "raw-colour"])
  })

  it("catches a hex inside a longer style value, whatever the quotes", () => {
    // Each as a string and as a template literal; the property is outside the
    // string, so the key before the opening quote is what says it holds a colour.
    const values = [
      ["boxShadow", "0 0 0 1px #fff", 1],
      ["border", "1px solid #1a1a1a", 1],
      ["background", "linear-gradient(to right, #fff, #000)", 2],
      ["filter", "drop-shadow(0 0 2px #fff)", 1],
      ["color", "color-mix(in oklab, #fff 20%, transparent)", 1],
      ["backgroundImage", "radial-gradient(#fff 10%, transparent)", 1],
      ["textShadow", "0 0 4px #000", 1],
      ["trackColor", "linear-gradient(#fff, #000)", 2],
      ["stroke", "url(#a) #fff", 1],
    ]
    for (const [key, value, count] of values) {
      const expected = Array(count).fill("raw-colour")
      expect(broken(`<i style={{ ${key}: "${value}" }} />`), `${key}, string`).toEqual(expected)
      expect(broken(`<i style={{ ${key}: '${value}' }} />`), `${key}, single quotes`).toEqual(expected)
      expect(broken("<i style={{ " + key + ": `" + value + "` }} />"), `${key}, template`).toEqual(expected)
    }
  })

  it("catches a hex after an interpolation, and in a quoted key", () => {
    expect(broken("<i style={{ boxShadow: `0 0 ${w}px #fff` }} />")).toEqual(["raw-colour"])
    expect(broken("<i style={{ boxShadow: `${a} ${b} #fff` }} />")).toEqual(["raw-colour"])
    expect(broken(`const look = { "box-shadow": "0 0 0 1px #fff" }`)).toEqual(["raw-colour"])
    expect(broken(`<circle stroke-width="2" stop-color="url(#g) #fff" />`)).toEqual(["raw-colour"])
  })

  it("catches a hex in a rule of CSS, one line or several", () => {
    expect(broken("const css = `.a { color: #fff }`")).toEqual(["raw-colour"])
    expect(broken(`const css = ".a { background-color: #fff; border: 1px solid #000 }"`)).toEqual([
      "raw-colour",
      "raw-colour",
    ])
    const text = ["const css = `", "  .a {", "    color: #fff;", "  }", "`"].join("\n")
    expect(checkText(SCREEN, text)).toEqual([{ rule: "raw-colour", line: 3, text: "#fff" }])
  })

  it("does not take every string in a style for a colour", () => {
    expect(broken(`<i label="Take #123" />`)).toEqual([])
    expect(broken(`<i style={{ label: "Take #123", content: "item #fee" }} />`)).toEqual([])
    expect(broken("<i style={{ content: `item #fee` }} />")).toEqual([])
    expect(broken(`<i data-note="see #add" aria-label="Take #fee" />`)).toEqual([])
  })

  it("reads a property only when it is one that holds a colour", () => {
    expect(broken(`const css = "color: #fff"`)).toEqual(["raw-colour"])
    expect(broken(`const css = "border: 1px solid #fff"`)).toEqual(["raw-colour"])
    expect(broken(`const css = "fill:#000"`)).toEqual(["raw-colour"])
    expect(broken(`const css = "box-shadow: 0 0 0 1px #fff"`)).toEqual(["raw-colour"])
    expect(broken(`const css = "take: #123 saved"`)).toEqual([])
    expect(broken(`toast("error: #404")`)).toEqual([])
    expect(broken(`<Group title="note: #fee" />`)).toEqual([])
    expect(broken(`const msg = "image: #123 uploaded, text: #add"`)).toEqual([])
  })

  it("does not skip a gradient's to-stop as if it were a link", () => {
    const text = [`const g = {`, `  from: "#fff",`, `  to: "#000",`, `}`].join("\n")
    expect(checkText(SCREEN, text)).toEqual([
      { rule: "raw-colour", line: 2, text: "#fff" },
      { rule: "raw-colour", line: 3, text: "#000" },
    ])
  })

  it("catches a colour function written in the code", () => {
    expect(broken(`<i style={{ color: "oklch(0.7 0.1 50)" }} />`)).toEqual(["raw-colour"])
    expect(broken(`<i style={{ background: "rgb(0, 0, 0)" }} />`)).toEqual(["raw-colour"])
  })

  it("catches a colour inside a template literal, and inside a cn() argument", () => {
    expect(broken("const c = `flex bg-red-500`")).toEqual(["raw-colour"])
    expect(broken("const c = `flex ${on ? 'text-white' : ''}`")).toEqual(["raw-colour"])
    expect(broken(`<i className={cn("flex", on && "bg-red-500")} />`)).toEqual(["raw-colour"])
    const text = [`<i`, `  className={cn(`, `    "flex",`, `    on ? "border-zinc-200" : "text-white",`, `  )}`, `/>`].join("\n")
    expect(checkText(SCREEN, text)).toEqual([
      { rule: "raw-colour", line: 4, text: "border-zinc-200" },
      { rule: "raw-colour", line: 4, text: "text-white" },
    ])
  })

  it("lets the theme's colours through", () => {
    expect(classes("bg-primary/20 text-foreground border-border")).toEqual([])
    expect(classes("bg-signal/15 text-warn ring-ring/50 bg-transparent border-current")).toEqual([])
    expect(classes("from-primary to-transparent")).toEqual([])
  })

  it("lets through a utility that only looks like a colour", () => {
    expect(classes("shadow-md ring-2 ring-offset-2 border-2 text-balance outline-hidden")).toEqual([])
    expect(classes("bg-red")).toEqual([])
    expect(broken(`color-mix(in oklab, var(--primary) 20%, transparent)`)).toEqual([])
  })

  it("does not take a number, an anchor or an entity for a hex", () => {
    expect(broken(`<p>Take #123 of 4</p>`)).toEqual([])
    expect(broken(`<p>It&#39;s here</p>`)).toEqual([])
    expect(broken(`<a href="#main">skip</a>`)).toEqual([])
    expect(broken(`<a href="#add">skip</a>`)).toEqual([])
    expect(broken(`<a aria-label="Take #123">go</a>`)).toEqual([])
    expect(broken(`<Item aria-label="Take #fee" title="Note: #add" />`)).toEqual([])
    expect(broken(`const link = { href: "#add", id: "#bad" }`)).toEqual([])
    expect(broken(`<use href="url(#abc)" />`)).toEqual([])
  })
})

describe("radius", () => {
  it("catches rounded-xs, rounded-2xl and up, and brackets", () => {
    expect(classes("rounded-xs")).toEqual(["radius"])
    expect(classes("rounded-2xl")).toEqual(["radius"])
    expect(classes("rounded-4xl")).toEqual(["radius"])
    expect(classes("rounded-[3px]")).toEqual(["radius"])
    expect(classes("rounded-[calc(var(--radius)-2px)]")).toEqual(["radius"])
  })

  it("catches them on any side or corner", () => {
    expect(classes("rounded-t-3xl")).toEqual(["radius"])
    expect(classes("rounded-bl-xs")).toEqual(["radius"])
    expect(classes("rounded-s-[6px] rounded-tr-2xl")).toEqual(["radius", "radius"])
    expect(classes("hover:rounded-e-[1px]")).toEqual(["radius"])
  })

  it("lets 4, 8, 12 and full through, on any side", () => {
    expect(classes("rounded rounded-sm rounded-md rounded-lg rounded-xl rounded-full rounded-none")).toEqual([])
    expect(classes("rounded-t-lg rounded-b-none rounded-tl-md rounded-r-full rounded-l")).toEqual([])
  })

  it("leaves other classes with a rounded in them alone", () => {
    expect(classes("not-rounded flex")).toEqual([])
  })
})

describe("uppercase", () => {
  it("catches the uppercase class, on any variant", () => {
    expect(classes("uppercase")).toEqual(["uppercase"])
    expect(classes("flex md:uppercase tracking-wide")).toEqual(["uppercase"])
    expect(broken(`<p style={{ textTransform: "uppercase" }} />`)).toEqual(["uppercase"])
  })

  it("catches it in any string or template literal", () => {
    expect(broken(`<i className={cn("flex", on && "uppercase")} />`)).toEqual(["uppercase"])
    expect(broken("const c = `flex ${a} uppercase`")).toEqual(["uppercase"])
    expect(broken(`const c = ["flex", 'uppercase']`)).toEqual(["uppercase"])
  })

  it("lets capitalize, normal-case and toUpperCase through", () => {
    expect(classes("capitalize normal-case lowercase")).toEqual([])
    expect(broken(`const key = name.toUpperCase()`)).toEqual([])
  })

  it("is about the class, not a variable or a word in the text", () => {
    expect(broken(`const uppercase = name.toUpperCase()`)).toEqual([])
    expect(broken(`return uppercase ? 1 : 2`)).toEqual([])
    expect(broken(`<p>Names are shown in uppercase here</p>`)).toEqual([])
    expect(broken(`<p>uppercase</p>`)).toEqual([])
  })
})

describe("raw-button", () => {
  it("catches a <button outside components/ui", () => {
    expect(broken(`<button type="button" onClick={go}>Go</button>`)).toEqual(["raw-button"])
    expect(broken(`return <button`)).toEqual(["raw-button"])
  })

  it("catches a button under a namespace, such as <motion.button", () => {
    expect(broken(`<motion.button whileTap={{ scale: 0.9 }}>Go</motion.button>`)).toEqual(["raw-button"])
    expect(broken(`<Primitive.button onClick={go} />`)).toEqual(["raw-button"])
  })

  it("lets <Button and friends through", () => {
    expect(broken(`<Button onClick={go}>Go</Button>`)).toEqual([])
    expect(broken(`<ButtonGroup><PlayButton /></ButtonGroup>`)).toEqual([])
    expect(broken(`<motion.div /><Primitive.Button /><buttonish />`)).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(broken(`<button type="button" />`, SHARED)).toEqual([])
    expect(broken(`<motion.button />`, SHARED)).toEqual([])
  })
})

describe("radix", () => {
  it("catches an import from radix-ui or @radix-ui outside components/ui", () => {
    expect(broken(`import { Dialog } from "radix-ui"`)).toEqual(["radix"])
    expect(broken(`import * as Popover from '@radix-ui/react-popover'`)).toEqual(["radix"])
    expect(broken(`} from "@radix-ui/react-slot"`)).toEqual(["radix"])
    expect(broken(`const m = await import("radix-ui")`)).toEqual(["radix"])
    expect(broken(`import "radix-ui"`)).toEqual(["radix"])
  })

  it("catches a subpath of radix-ui too", () => {
    expect(broken(`import { x } from "radix-ui/internal"`)).toEqual(["radix"])
    expect(broken(`const m = await import('radix-ui/internal')`)).toEqual(["radix"])
  })

  it("lets our own wrappers through", () => {
    expect(broken(`import { Dialog } from "@/components/ui/dialog"`)).toEqual([])
    expect(broken(`import { cn } from "@/lib/radix-ui-helpers"`)).toEqual([])
  })

  it("lets components/ui import it", () => {
    expect(broken(`import { Slot } from "radix-ui"`, SHARED)).toEqual([])
  })
})

describe("dialog", () => {
  it("catches role=dialog and <dialog outside components/ui", () => {
    expect(broken(`<div role="dialog" aria-modal="true">`)).toEqual(["dialog"])
    expect(broken(`<div role='alertdialog'>`)).toEqual(["dialog"])
    expect(broken(`<dialog open>`)).toEqual(["dialog"])
  })

  it("lets the shared Dialog through", () => {
    expect(broken(`<Dialog open={open}><DialogContent>x</DialogContent></Dialog>`)).toEqual([])
    expect(broken(`<div role="group">`)).toEqual([])
  })

  it("lets a selector that finds a dialog through: it makes none", () => {
    expect(broken(`const open = document.querySelectorAll('[role="dialog"]')`)).toEqual([])
    expect(broken(`const LAYERS = '[role="dialog"], [ role = "alertdialog" ], [role="menu"]'`)).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(broken(`<dialog open>`, SHARED)).toEqual([])
  })
})

describe("raw-field", () => {
  it("catches <input, <textarea and <select outside components/ui", () => {
    expect(broken(`<input value={name} onChange={change} />`)).toEqual(["raw-field"])
    expect(broken(`<textarea rows={3} />`)).toEqual(["raw-field"])
    expect(broken(`<select value={port}>`)).toEqual(["raw-field"])
    expect(broken(`<motion.input />`)).toEqual(["raw-field"])
  })

  it("lets a file picker through, which shadcn has nothing for", () => {
    expect(broken(`<input type="file" hidden />`)).toEqual([])
    expect(broken(`<input hidden type='file' accept="image/png" />`)).toEqual([])
    expect(broken(`<input type={"file"} />`)).toEqual([])
  })

  it("reads the type two lines under <input", () => {
    expect(broken(lines(`<input`, `  ref={pick}`, `  type="file"`, `  hidden`, `/>`))).toEqual([])
    expect(checkText(SCREEN, lines(`<input`, `  ref={pick}`, `  type="text"`, `/>`))).toEqual([
      { rule: "raw-field", line: 1, text: "<input" },
    ])
  })

  it("takes only the input's own type, not one further on", () => {
    expect(broken(lines(`<input value={v} />`, `<input type="file" />`))).toEqual(["raw-field"])
  })

  it("lets Input, Textarea, Select and InputGroup through", () => {
    expect(broken(`<Input value={name} />`)).toEqual([])
    expect(broken(`<Textarea rows={3} />`)).toEqual([])
    expect(broken(`<Select value={port}><SelectTrigger /></Select>`)).toEqual([])
    expect(broken(`<InputGroup><InputGroupInput /></InputGroup>`)).toEqual([])
    expect(broken(`const el = ref.current as HTMLInputElement`)).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(broken(`<input className="flex" />`, SHARED)).toEqual([])
  })
})

describe("raw-label", () => {
  it("catches <label outside components/ui", () => {
    expect(broken(`<label htmlFor="name">Name</label>`)).toEqual(["raw-label"])
    expect(broken(lines(`<label`, `  className="flex"`, `>`))).toEqual(["raw-label"])
  })

  it("lets Label, FieldLabel and aria-label through", () => {
    expect(broken(`<Label htmlFor="name">Name</Label>`)).toEqual([])
    expect(broken(`<FieldLabel>Name</FieldLabel>`)).toEqual([])
    expect(broken(`<i aria-label="Name" />`)).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(broken(`<label className="flex" />`, SHARED)).toEqual([])
  })
})

describe("spinner", () => {
  it("catches animate-spin outside components/ui", () => {
    expect(classes("size-4 animate-spin")).toEqual(["spinner"])
    expect(classes("motion-safe:animate-spin")).toEqual(["spinner"])
    expect(broken(`<Loader2Icon className={cn("size-4", busy && "animate-spin")} />`)).toEqual(["spinner"])
  })

  it("lets Spinner and other animations through", () => {
    expect(broken(`<Spinner quiet />`)).toEqual([])
    expect(classes("animate-pulse animate-spin-slow")).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(classes("size-4 animate-spin", SHARED)).toEqual([])
  })
})

describe("native-tip", () => {
  it("catches title= on an HTML element", () => {
    expect(broken(`<span title={name}>{name}</span>`)).toEqual(["native-tip"])
    expect(broken(`<a href={url} title="The take">x</a>`)).toEqual(["native-tip"])
    expect(broken(`<motion.div title="x" />`)).toEqual(["native-tip"])
  })

  it("catches title= on a router Link", () => {
    expect(broken(`<Link to="/songs" title="All songs">Songs</Link>`)).toEqual(["native-tip"])
  })

  it("names the tag in what it reports", () => {
    expect(checkText(SCREEN, `<span title={name} />`)).toEqual([{ rule: "native-tip", line: 1, text: "<span title=" }])
  })

  it("finds the tag of a title= two lines under <span", () => {
    expect(checkText(SCREEN, lines(`<span`, `  className="truncate"`, `  title={name}`, `>`))).toEqual([
      { rule: "native-tip", line: 3, text: "<span title=" },
    ])
  })

  it("lets an iframe's title through: it names the frame", () => {
    expect(broken(`<iframe title="The take" src={url} />`)).toEqual([])
    expect(broken(lines(`<iframe`, `  src={url}`, `  title="The take"`, `/>`))).toEqual([])
  })

  it("lets a title prop of our own component through", () => {
    expect(broken(`<Group title="Notes" hint="2">`)).toEqual([])
    expect(broken(lines(`<Group`, `  hint={String(n)}`, `  title="Tracks"`, `>`))).toEqual([])
    expect(broken(`<ConfirmDialog title={asking && \`Delete “\${name}”?\`} />`)).toEqual([])
  })

  it("skips strings and braces on its way back to the tag", () => {
    expect(broken(`<Group action={<Button size="row">Add</Button>} title="Files">`)).toEqual([])
    expect(broken(lines(`<Group`, `  action={`, `    <span className="a">x</span>`, `  }`, `  title="Files"`, `>`))).toEqual([])
    expect(broken(`<Group label="a > b" title="Files">`)).toEqual([])
    expect(broken(`<Group onPick={(a) => a > 1} title="Files">`)).toEqual([])
    expect(broken(`<Group action={<span title="x" />} title="Files">`)).toEqual(["native-tip"])
  })

  it("leaves a title that is not an attribute alone", () => {
    expect(broken(`const title = song.title`)).toEqual([])
    expect(broken(`el.title = "x"`)).toEqual([])
    expect(broken(`const look = { title: "x" }`)).toEqual([])
    expect(broken(`function Row({ title = "" }) {}`)).toEqual([])
    expect(broken(`if (title === null) return`)).toEqual([])
    expect(broken(`names.map(title => title.trim())`)).toEqual([])
    expect(broken(`<p>The title= here</p>`)).toEqual([])
    expect(broken(`<span data-title="x" aria-label="x" />`)).toEqual([])
    expect(broken(`<PaneHead subtitle="x" />`)).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(broken(`<span title={name} />`, SHARED)).toEqual([])
  })
})

describe("pressed-button", () => {
  it("catches aria-pressed on Button", () => {
    expect(broken(`<Button variant="ghost" aria-pressed={on}>Songs</Button>`)).toEqual(["pressed-button"])
    expect(broken(`<Button aria-pressed>Songs</Button>`)).toEqual(["pressed-button"])
    expect(checkText(SCREEN, lines(`<Button`, `  variant="ghost"`, `  aria-pressed={on}`, `>`))).toEqual([
      { rule: "pressed-button", line: 3, text: "<Button aria-pressed" },
    ])
  })

  it("lets Toggle and a selector that finds a pressed one through", () => {
    expect(broken(`<Toggle pressed={on} onPressedChange={set}>Songs</Toggle>`)).toEqual([])
    expect(broken(`const on = el.matches('[aria-pressed="true"]')`)).toEqual([])
    expect(broken(`<Button aria-expanded={open}>More</Button>`)).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(broken(`<Button aria-pressed={on} />`, SHARED)).toEqual([])
  })
})

describe("card", () => {
  it("catches rounded-xl with bg-card in one class string", () => {
    expect(classes("rounded-xl bg-card p-4")).toEqual(["card"])
    expect(classes("flex rounded-xl border bg-card/60")).toEqual(["card"])
    expect(broken(`<div className={cn("p-4", "md:rounded-xl bg-card")} />`)).toEqual(["card"])
    expect(broken("const box = `bg-card ${pad} rounded-xl`")).toEqual(["card"])
  })

  it("reads a template literal over several lines as one string, from the line it starts on", () => {
    expect(checkText(SCREEN, lines("const box = `rounded-xl", "  bg-card`"))).toEqual([
      { rule: "card", line: 1, text: "rounded-xl bg-card" },
    ])
    expect(checkText(SCREEN, lines("const a = 1", "const box = `", "  rounded-xl", "", "  ${pad}", "  bg-card", "`"))).toEqual([
      { rule: "card", line: 2, text: "rounded-xl bg-card" },
    ])
    expect(broken(lines("const a = `rounded-xl`", "const b = `bg-card`"))).toEqual([])
    expect(broken(lines("const a = `x", "  rounded-xl` + `bg-card", "  y`"))).toEqual([])
  })

  it("keeps two strings apart: one class string is the rule", () => {
    expect(broken(`<div className={cn("rounded-xl", "bg-card")} />`)).toEqual([])
  })

  it("lets Card, and either class alone, through", () => {
    expect(broken(`<Card className="p-4" />`)).toEqual([])
    expect(classes("rounded-xl bg-muted")).toEqual([])
    expect(classes("rounded-lg bg-card")).toEqual([])
    expect(classes("rounded-xl text-card-foreground")).toEqual([])
  })

  it("lets components/ui build its own", () => {
    expect(classes("rounded-xl bg-card", SHARED)).toEqual([])
  })
})

describe("story", () => {
  it("asks for a stories file beside every component in components/ui", () => {
    const found = missingStories([
      "ui/src/components/ui/button.tsx",
      "ui/src/components/ui/button.stories.tsx",
      "ui/src/components/ui/card.tsx",
      "ui/src/screens/Example.tsx",
    ])
    expect(found.map((f) => [f.path, f.rule])).toEqual([["ui/src/components/ui/card.tsx", "story"]])
    expect(found[0].line).toBe(1)
  })

  it("leaves stories, tests and files elsewhere alone", () => {
    expect(
      missingStories([
        "ui/src/components/ui/badge.stories.tsx",
        "ui/src/components/ui/button.test.ts",
        "ui/src/components/ui/button.stories.tsx",
        "ui/src/components/Other.tsx",
        "ui/src/components/ui/nested/thing.tsx",
      ]),
    ).toEqual([])
  })
})

describe("design-ok", () => {
  it("exempts a line whose own comment gives a reason", () => {
    expect(broken(`<i className="rounded-[1px]" /> {/* design-ok(radius): a 2 px tick */}`)).toEqual([])
    expect(broken(`<i className="rounded-[1px]" /> // design-ok(radius): a 2 px tick`)).toEqual([])
  })

  it("exempts the line below a comment", () => {
    const text = [`// design-ok(radius): graphic`, `<i className="rounded-[1px]" />`].join("\n")
    expect(broken(text)).toEqual([])
    expect(broken(`{/* design-ok(radius): graphic */}\n<i className="rounded-[1px]" />`)).toEqual([])
    expect(broken(`/* design-ok(radius): graphic */\n<i className="rounded-[1px]" />`)).toEqual([])
  })

  it("does not reach further than the next line", () => {
    const text = [`// design-ok(radius): graphic`, `const a = 1`, `<i className="rounded-[1px]" />`].join("\n")
    expect(checkText(SCREEN, text)).toEqual([{ rule: "radius", line: 3, text: "rounded-[1px]" }])
  })

  it("needs a reason", () => {
    expect(broken(`// design-ok(radius):\n<i className="rounded-[1px]" />`)).toEqual(["radius"])
    expect(broken(`// design-ok(radius):   \n<i className="rounded-[1px]" />`)).toEqual(["radius"])
    expect(broken(`{/* design-ok(radius): */}\n<i className="rounded-[1px]" />`)).toEqual(["radius"])
    expect(broken(`// design-ok(radius)\n<i className="rounded-[1px]" />`)).toEqual(["radius"])
  })

  it("exempts only the rule it names", () => {
    const text = [`// design-ok(radius): graphic`, `<i className="rounded-[1px] bg-red-500" />`].join("\n")
    expect(broken(text)).toEqual(["raw-colour"])
    expect(broken(`// design-ok(raw-colour): graphic\n<i className="rounded-[1px]" />`)).toEqual(["radius"])
  })

  it("can name two rules in one comment", () => {
    const text = `// design-ok(radius): a tick design-ok(raw-colour): the lane's own paint\n<i className="rounded-[1px] bg-red-500" />`
    expect(broken(text)).toEqual([])
  })
})

describe("what counts as code", () => {
  it("reports the line number and the text that broke the rule", () => {
    const text = [`const a = 1`, ``, `<p className="flex text-lg" />`].join("\n")
    expect(checkText(SCREEN, text)).toEqual([{ rule: "text-size", line: 3, text: "text-lg" }])
  })

  it("counts lines the same with Windows line endings", () => {
    const text = `const a = 1\r\n\r\n<p className="uppercase" />\r\n`
    expect(checkText(SCREEN, text)).toEqual([{ rule: "uppercase", line: 3, text: "uppercase" }])
  })

  it("does not read comments as code", () => {
    expect(broken(`// no uppercase and no text-lg here, as <button> says`)).toEqual([])
    expect(broken(`/* text-3xl\n   rounded-2xl <button> */`)).toEqual([])
    expect(broken(`{/* a <button> that is gone: bg-red-500 */}`)).toEqual([])
    expect(broken(`const a = 1 // was uppercase`)).toEqual([])
  })

  it("does not take a // inside a string for a comment", () => {
    expect(broken(`const u = "https://reha.stream"; return <button />`)).toEqual(["raw-button"])
    expect(broken("const u = `http://x/${a}`; return <button />")).toEqual(["raw-button"])
  })

  it("reads class names inside template literals, over several lines", () => {
    const text = ["const c = `", "  flex", "  ${on ? `rounded-2xl` : `rounded-md`}", "`"].join("\n")
    expect(checkText(SCREEN, text)).toEqual([{ rule: "radius", line: 3, text: "rounded-2xl" }])
  })

  it("reads a regular expression as one, not as a comment or a template", () => {
    expect(broken(`const re = /https?:\\/\\//; return <button />`)).toEqual(["raw-button"])
    expect(broken(["const re = /`/g", "const s = 1", "const x = <button />"].join("\n"))).toEqual(["raw-button"])
    expect(broken(`const re = /[/]x/; return <button />`)).toEqual(["raw-button"])
    expect(broken(`if (/https?:\\/\\//.test(u)) return <button />`)).toEqual(["raw-button"])
    expect(broken(`const ok = a && !/x\\//.test(u)\nconst b = <button />`)).toEqual(["raw-button"])
    expect(broken(`/^\\/\\//.test(u) ? <button /> : null`)).toEqual(["raw-button"])
  })

  it("does not read what is inside a regular expression as code", () => {
    expect(broken(`const re = /text-lg|uppercase|<button/`)).toEqual([])
  })

  it("does not take a slash that divides, or closes a tag, for a regular expression", () => {
    expect(broken(`<p className="a">{n} / {total}</p> <button />`)).toEqual(["raw-button"])
    expect(broken(`const h = (a + b) / 2; const r = <button className="uppercase" />`)).toEqual(["uppercase", "raw-button"])
    expect(broken(`const h = a / 2 / c; const r = <button />`)).toEqual(["raw-button"])
    expect(broken(`<Foo onClick={go} /> <button />`)).toEqual(["raw-button"])
    expect(broken(`<img src="a" /><p>text-lg</p><button />`)).toEqual(["text-size", "raw-button"])
  })

  it("keeps going after an apostrophe in running text", () => {
    expect(broken(`<p>It's a take</p>\n<button />`)).toEqual(["raw-button"])
  })

  it("takes a ' straight after a letter or a digit for an apostrophe, not a string", () => {
    expect(checkText(SCREEN, `<p>It's here <span title="z">x</span></p>`)).toEqual([
      { rule: "native-tip", line: 1, text: "<span title=" },
    ])
    expect(broken(`<p>Don't</p> <Button aria-pressed={on}>Songs</Button>`)).toEqual(["pressed-button"])
    expect(broken(`<p>The 90's</p> <Button aria-pressed={on}>Songs</Button>`)).toEqual(["pressed-button"])
    expect(broken(`<span data-x="title=1" />`)).toEqual([])
    expect(broken(`const s = 'title=1'`)).toEqual([])
    expect(broken(`<p>Rock 'n' roll</p> <i className={cn('flex', on && 'uppercase')} />`)).toEqual(["uppercase"])
  })

  it("takes a Windows path as well", () => {
    expect(checkText("ui\\src\\screens\\Example.tsx", `<p className="text-lg" />`)).toEqual([
      { rule: "text-size", line: 1, text: "text-lg" },
    ])
    expect(checkText("ui\\src\\components\\ui\\card.tsx", `<button />`)).toEqual([])
    expect(checkText("ui\\src\\components\\Other.tsx", `<button />`)).toEqual([
      { rule: "raw-button", line: 1, text: "<button" },
    ])
  })

  it("checks src/**/*.tsx and the .ts beside them, but not tests", () => {
    const bad = `<button className="uppercase text-lg" />`
    expect(checkText("ui/e2e/example.tsx", bad)).toEqual([])
    expect(checkText("ui/src/index.css", bad)).toEqual([])
    expect(checkText("ui/src/screens/Example.tsx", bad).length).toBeGreaterThan(0)
    // Class strings live in .ts too (lib/labels.ts).
    expect(checkText("ui/src/lib/example.ts", `const look = "rounded-[3px] text-[13px]"`)).toEqual([
      { rule: "px-text", line: 1, text: "text-[13px]" },
      { rule: "radius", line: 1, text: "rounded-[3px]" },
    ])
    expect(checkText("ui/src/lib/example.test.ts", bad)).toEqual([])
    expect(checkText("ui/src/components/ui/button.test.ts", bad)).toEqual([])
  })

  it("checks stories like any other file", () => {
    expect(broken(`<div className="text-lg" />`, "ui/src/components/ui/card.stories.tsx")).toEqual(["text-size"])
  })
})

describe("the three parts", () => {
  const bad = `<button className="text-lg" />`

  it("checks the app, the service and the site, by paths from the repository's root", () => {
    expect(broken(bad, "ui/src/screens/Example.tsx")).toEqual(["text-size", "raw-button"])
    expect(broken(bad, "service/src/shell/Shell.tsx")).toEqual(["text-size", "raw-button"])
    expect(broken(bad, "site/src/page/Example.tsx")).toEqual(["text-size", "raw-button"])
    expect(broken(bad, "service\\src\\shell\\Shell.tsx")).toEqual(["text-size", "raw-button"])
  })

  it("checks nothing outside the three parts' src/", () => {
    expect(broken(bad, "src/screens/Example.tsx")).toEqual([])
    expect(broken(bad, "service/worker/letters.ts")).toEqual([])
    expect(broken(bad, "service/e2e/example.tsx")).toEqual([])
    expect(broken(bad, "site/src/page/page.test.tsx")).toEqual([])
    expect(broken(bad, "docs/src/Example.tsx")).toEqual([])
  })

  it("lets only ui/src/components/ui build its own", () => {
    expect(broken(bad, "ui/src/components/ui/card.tsx")).toEqual(["text-size"])
    expect(broken(bad, "service/src/components/ui/card.tsx")).toEqual(["text-size", "raw-button"])
    expect(missingStories(["service/src/components/ui/card.tsx", "site/src/components/ui/card.tsx"])).toEqual([])
    expect(judge([], { "service/src/components/ui/card.tsx": ["radius"] })[0].text).toMatch(/nothing breaks it/)
  })

  it("walks the parts named, and all three when none is", () => {
    expect(partsToCheck([])).toEqual(["ui", "service", "site"])
    expect(partsToCheck(["service"])).toEqual(["service"])
    expect(partsToCheck(["site", "ui"])).toEqual(["ui", "site"])
    expect(() => partsToCheck(["server"])).toThrow(/ui, service or site/)
  })

  it("walks only the part named on the command line", () => {
    const script = fileURLToPath(new URL("./design-check.mjs", import.meta.url))
    const checked = (args) => {
      const run = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
      const ok = /^design-check: ok, (\d+) files checked in ([a-z, ]+);/.exec(run.stdout)
      expect(ok, run.stdout).not.toBeNull()
      return { files: Number(ok[1]), parts: ok[2] }
    }
    const site = checked(["site"])
    const all = checked([])
    expect(site.parts).toBe("site")
    expect(all.parts).toBe("ui, service, site")
    expect(site.files).toBeGreaterThan(0)
    expect(site.files).toBeLessThan(all.files)

    const odd = spawnSync(process.execPath, [script, "server"], { encoding: "utf8" })
    expect(odd.status).toBe(2)
    expect(odd.stderr).toMatch(/ui, service or site/)
  })
})

describe("the allow-list", () => {
  const found = [
    { path: "ui/src/screens/A.tsx", rule: "radius", line: 4, text: "rounded-2xl" },
    { path: "ui/src/screens/A.tsx", rule: "uppercase", line: 9, text: "uppercase" },
  ]

  it("passes when every finding's file and rule is listed", () => {
    expect(judge(found, { "ui/src/screens/A.tsx": ["radius", "uppercase"] })).toEqual([])
  })

  it("reports a finding whose file or rule is not listed, with its line", () => {
    expect(judge(found, { "ui/src/screens/A.tsx": ["radius"] })).toEqual([found[1]])
    expect(judge(found, { "ui/src/screens/B.tsx": ["radius", "uppercase"] }).map((p) => p.path)).toContain(
      "ui/src/screens/A.tsx",
    )
  })

  it("reports a listed pair with no finding left, so the list only shrinks", () => {
    const left = judge([found[0]], { "ui/src/screens/A.tsx": ["radius", "uppercase"] })
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ path: "ui/src/screens/A.tsx", rule: "uppercase" })
    expect(left[0].text).toMatch(/allow-list/)
  })

  it("reports a listed file that is gone", () => {
    const left = judge([], { "ui/src/screens/Gone.tsx": ["radius"] })
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ path: "ui/src/screens/Gone.tsx", rule: "radius" })
  })

  it("refuses a file of components/ui on the list, and a rule it does not know", () => {
    const ui = judge([], { "ui/src/components/ui/card.tsx": ["radius"] })
    expect(ui.some((p) => /components\/ui/.test(p.text))).toBe(true)
    const odd = judge(found, { "ui/src/screens/A.tsx": ["radius", "uppercase", "nonsense"] })
    expect(odd.some((p) => p.rule === "nonsense")).toBe(true)
  })
})

describe("design-check.allow.json", () => {
  // Settings was the last screen: the list is empty for good, so a new
  // screen keeps the rules from its first line.
  it("the allow-list is empty: every screen is redone", () => {
    const list = new URL("../design-check.allow.json", import.meta.url)
    expect(JSON.parse(readFileSync(list, "utf8"))).toEqual({})
  })
})
