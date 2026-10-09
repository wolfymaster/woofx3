import { describe, expect, mock, test } from "bun:test";
import { isListSettingValue, modulesRoutes } from "../src/routes/modules";

type UpdateModuleSetting = (moduleId: string, key: string, value: string) => Promise<unknown>;

function hostWith(valueType: string) {
  const setModuleSetting = mock(async (row: Record<string, string>) => row);
  const host = {
    db: {
      listModuleSettings: mock(async () => ({ settings: [{ key: "items", value: "[]", valueType }] })),
      setModuleSetting,
    },
  };
  const update = (modulesRoutes.updateModuleSetting as unknown as UpdateModuleSetting).bind(host);
  return { update, setModuleSetting };
}

describe("list module settings", () => {
  test("a JSON array of rows is a list value", () => {
    expect(isListSettingValue("[]")).toBe(true);
    expect(isListSettingValue('[{"label":"Pizza"}]')).toBe(true);
  });

  test("anything else is not", () => {
    for (const value of ["", "Pizza", "{}", '["Pizza"]', "[null]", "[[]]"]) {
      expect(isListSettingValue(value)).toBe(false);
    }
  });

  test("saving a list setting stores its rows", async () => {
    const { update, setModuleSetting } = hostWith("list");
    await update("woofx3_wheel_spin", "items", '[{"label":"Pizza"}]');
    expect(setModuleSetting).toHaveBeenCalledWith({
      moduleId: "woofx3_wheel_spin",
      key: "items",
      value: '[{"label":"Pizza"}]',
      valueType: "list",
    });
  });

  test("saving a list setting refuses a value that isn't rows", async () => {
    const { update, setModuleSetting } = hostWith("list");
    await expect(update("woofx3_wheel_spin", "items", "Pizza")).rejects.toThrow("JSON array");
    expect(setModuleSetting).not.toHaveBeenCalled();
  });

  test("other settings are saved as they are", async () => {
    const { update, setModuleSetting } = hostWith("text");
    await update("woofx3_wheel_spin", "items", "Pizza");
    expect(setModuleSetting).toHaveBeenCalledTimes(1);
  });
});
