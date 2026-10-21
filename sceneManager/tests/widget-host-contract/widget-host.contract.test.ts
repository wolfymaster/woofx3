import { mockHarness } from "./mock-harness";
import { realHarness } from "./real-harness";
import { describeWidgetHostContract } from "./widget-host.contract";

describeWidgetHostContract("shim + bridge", realHarness);
describeWidgetHostContract("mock host", mockHarness);
