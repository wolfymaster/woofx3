import { describe, expect, test } from "bun:test";
import { type BindResult, bindInputs, type CompositionDocument, type InputField, inputReferences } from "../model";

function compose(
  settings: Record<string, unknown>,
  inputs: InputField[],
  extras: { params?: Record<string, unknown>; layout?: Record<string, unknown> } = {}
): CompositionDocument {
  return {
    layout: { width: 1920, height: 1080, ...extras.layout },
    widgets: {
      w1: {
        widget: "woofx3:widget:text",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        visible: true,
        z: "a0",
        settings,
        name: "{{name}}",
        rotation: 0,
        opacity: 1,
        locked: false,
        extra: {},
      },
    },
    behaviors: {
      b1: {
        type: "effect",
        kind: "glow",
        target: "w1",
        order: "a0",
        timing: { anchor: "enter", offsetMs: 0, durationMs: 500, easing: "linear" },
        params: extras.params ?? {},
      },
    },
    inputs,
  };
}

function input(id: string, type: string, defaultValue?: unknown): InputField {
  const field: InputField = { id, label: id, type };
  if (defaultValue !== undefined) {
    field.defaultValue = defaultValue;
  }
  return field;
}

function bound(result: BindResult): CompositionDocument {
  if (!result.ok) {
    throw new Error(`expected bind to succeed: ${JSON.stringify(result.report)}`);
  }
  return result.document;
}

describe("whole values", () => {
  test("keep the input's type", () => {
    const doc = compose(
      {
        count: { $input: "count" },
        enabled: { $input: "enabled" },
        colors: { $input: "colors" },
        media: { $input: "media" },
      },
      [input("count", "number"), input("enabled", "boolean"), input("colors", "list"), input("media", "asset")]
    );
    const media = { url: "https://example.test/a.png", kind: "image" };
    const result = bound(bindInputs(doc, { count: 3, enabled: false, colors: ["#fff", "#000"], media }));
    expect(result.widgets.w1.settings).toEqual({ count: 3, enabled: false, colors: ["#fff", "#000"], media });
    // The bound document never shares objects with the caller's values.
    expect(result.widgets.w1.settings.media).not.toBe(media);
  });

  test("take the declared default when no value is given", () => {
    const doc = compose({ size: { $input: "size" }, label: { $input: "label" } }, [
      input("size", "number", 48),
      input("label", "text", ""),
    ]);
    const result = bound(bindInputs(doc, {}));
    expect(result.widgets.w1.settings).toEqual({ size: 48, label: "" });
  });

  test("a given value wins over the default, and null is a value", () => {
    const doc = compose({ size: { $input: "size" } }, [input("size", "number", 48)]);
    expect(bound(bindInputs(doc, { size: 12 })).widgets.w1.settings.size).toBe(12);
    expect(bound(bindInputs(doc, { size: null })).widgets.w1.settings.size).toBeNull();
    expect(bound(bindInputs(doc, { size: undefined })).widgets.w1.settings.size).toBe(48);
  });

  test("are replaced deep in nested settings and arrays", () => {
    const doc = compose(
      { style: { font: { size: { $input: "size" } } }, rows: [{ title: { $input: "title" } }, "{{title}}!"] },
      [input("size", "number"), input("title", "text")]
    );
    const result = bound(bindInputs(doc, { size: 20, title: "Hi" }));
    expect(result.widgets.w1.settings).toEqual({ style: { font: { size: 20 } }, rows: [{ title: "Hi" }, "Hi!"] });
  });
});

describe("text", () => {
  test("interpolates values as text", () => {
    const doc = compose({ message: "{{user}} gave {{ amount }} ({{paid}}) {{meta}} {{nothing}}" }, [
      input("user", "text"),
      input("amount", "number"),
      input("paid", "boolean"),
      input("meta", "list"),
      input("nothing", "text"),
    ]);
    const result = bound(bindInputs(doc, { user: "wolfy", amount: 5.5, paid: true, meta: { a: [1] }, nothing: null }));
    expect(result.widgets.w1.settings.message).toBe('wolfy gave 5.5 (true) {"a":[1]} ');
  });

  test("a string that is only a reference still becomes text", () => {
    const doc = compose({ size: "{{size}}" }, [input("size", "number")]);
    expect(bound(bindInputs(doc, { size: 7 })).widgets.w1.settings.size).toBe("7");
  });

  test("an escaped brace pair is literal, and backslash pairs before it are halved", () => {
    const doc = compose(
      {
        literal: "use \\{{name}} to show a name",
        slash: "C:\\\\{{dir}}",
        oddRun: "\\\\\\{{dir}}",
        elsewhere: "a\\b }} {",
      },
      [input("dir", "text")]
    );
    const result = bound(bindInputs(doc, { dir: "home" }));
    expect(result.widgets.w1.settings).toEqual({
      literal: "use {{name}} to show a name",
      slash: "C:\\home",
      oddRun: "\\{{dir}}",
      elsewhere: "a\\b }} {",
    });
  });

  test("values are not read again, so text from a viewer cannot reach another input", () => {
    const doc = compose({ message: "{{text}}", raw: { $input: "text" } }, [
      input("text", "text"),
      input("secret", "text", "s"),
    ]);
    const result = bound(bindInputs(doc, { text: "{{secret}} \\{{" }));
    expect(result.widgets.w1.settings).toEqual({ message: "{{secret}} \\{{", raw: "{{secret}} \\{{" });
  });
});

describe("what is walked", () => {
  test("settings, behavior params and the layout are bound; ids and structure are not", () => {
    const doc = compose({ title: "{{name}}" }, [input("name", "text"), input("bg", "color"), input("color", "color")], {
      params: { color: { $input: "color" } },
      layout: { backgroundColor: { $input: "bg" } },
    });
    const result = bound(bindInputs(doc, { name: "Ada", bg: "#000000", color: "#ff0000" }));
    expect(result.widgets.w1.settings.title).toBe("Ada");
    expect(result.behaviors.b1.params.color).toBe("#ff0000");
    expect(result.layout.backgroundColor).toBe("#000000");
    // The placement's name is not a bindable part.
    expect(result.widgets.w1.name).toBe("{{name}}");
    expect(Object.keys(result.widgets)).toEqual(["w1"]);
    expect(result.behaviors.b1.target).toBe("w1");
  });

  test("the input document is left unchanged", () => {
    const doc = compose({ title: { $input: "name" } }, [input("name", "text")]);
    const before = structuredClone(doc);
    bound(bindInputs(doc, { name: "Ada" }));
    expect(doc).toEqual(before);
  });
});

describe("report", () => {
  test("lists missing inputs, unknown values and unknown references", () => {
    const doc = compose({ title: "{{name}} {{ghost}}", size: { $input: "phantom" } }, [
      input("name", "text"),
      input("size", "number"),
      input("color", "color", "#fff"),
    ]);
    const result = bindInputs(doc, { name: "Ada", extra: 1, also: "x" });
    expect(result.ok).toBe(false);
    expect(result.report).toEqual({
      missing: ["size"],
      unknownValues: ["also", "extra"],
      unknownReferences: [
        { input: "ghost", path: ["widgets", "w1", "settings", "title"], form: "text" },
        { input: "phantom", path: ["widgets", "w1", "settings", "size"], form: "value" },
      ],
      malformed: [],
    });
  });

  test("unknown values alone do not fail the bind", () => {
    const doc = compose({ title: "{{name}}" }, [input("name", "text")]);
    const result = bindInputs(doc, { name: "Ada", extra: 1 });
    expect(result.ok).toBe(true);
    expect(result.report.unknownValues).toEqual(["extra"]);
  });

  test("a declared input without a value or default fails even when unused", () => {
    const doc = compose({}, [input("unused", "text")]);
    const result = bindInputs(doc, {});
    expect(result.ok).toBe(false);
    expect(result.report.missing).toEqual(["unused"]);
  });

  test("malformed references fail the bind", () => {
    const doc = compose(
      {
        open: "{{ not closed",
        empty: "{{}}",
        spaced: "{{two words}}",
        mixed: { $input: "name", other: 1 },
        typed: { $input: 3 },
      },
      [input("name", "text")]
    );
    const result = bindInputs(doc, { name: "Ada" });
    expect(result.ok).toBe(false);
    expect(result.report.malformed).toEqual([
      ["widgets", "w1", "settings", "open"],
      ["widgets", "w1", "settings", "empty"],
      ["widgets", "w1", "settings", "spaced"],
      ["widgets", "w1", "settings", "mixed"],
      ["widgets", "w1", "settings", "typed"],
    ]);
  });

  test("a composition without inputs binds to a copy of itself", () => {
    const doc = compose({ title: "plain" }, []);
    delete doc.inputs;
    const result = bindInputs(doc, {});
    expect(bound(result)).toEqual(doc);
    expect(result.report).toEqual({ missing: [], unknownValues: [], unknownReferences: [], malformed: [] });
  });

  test("an input declared twice fails fast", () => {
    const doc = compose({}, [input("a", "text", ""), input("a", "number", 1)]);
    expect(() => bindInputs(doc, {})).toThrow(/declared twice/);
  });
});

describe("inputReferences", () => {
  test("lists every use in document order", () => {
    const doc = compose({ title: "{{name}} and {{name}}", nested: [{ size: { $input: "size" } }] }, [], {
      params: { color: { $input: "color" } },
      layout: { title: "{{show}}" },
    });
    expect(inputReferences(doc)).toEqual([
      { input: "show", path: ["layout", "title"], form: "text" },
      { input: "name", path: ["widgets", "w1", "settings", "title"], form: "text" },
      { input: "name", path: ["widgets", "w1", "settings", "title"], form: "text" },
      { input: "size", path: ["widgets", "w1", "settings", "nested", 0, "size"], form: "value" },
      { input: "color", path: ["behaviors", "b1", "params", "color"], form: "value" },
    ]);
  });

  test("escaped braces are not references", () => {
    expect(inputReferences(compose({ title: "\\{{name}}" }, []))).toEqual([]);
  });
});
