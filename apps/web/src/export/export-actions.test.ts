/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { exportFileName } from "./export-actions";

describe("exportFileName", () => {
  test("slugs the node name and adds the format", () => {
    expect(exportFileName("Checkout — Payment", "png@1x")).toBe("checkout-payment.png");
    expect(exportFileName("Checkout — Payment", "png@2x")).toBe("checkout-payment@2x.png");
    expect(exportFileName("Pricing Card", "html")).toBe("pricing-card.html");
    expect(exportFileName(undefined, "svg")).toBe("export.svg");
  });
});
