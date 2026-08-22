import { JSDOM } from "jsdom";
import { extractFormFields } from "./src/services/form/fieldExtractor";
import { matchFieldsHeuristically } from "./src/services/heuristicMatcher";
import { resolveFieldValues } from "./src/background/modules/fieldResolver";
import {
  fillFormField,
  processCustomFields,
} from "./src/services/formAnalyzer";
import type { CustomField, UserData } from "./src/types";

function setupDom(html: string) {
  const dom = new JSDOM(html, {
    url: "https://example.com/form",
    pretendToBeVisual: true,
  });

  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  (global as any).HTMLElement = dom.window.HTMLElement;
  (global as any).HTMLInputElement = dom.window.HTMLInputElement;
  (global as any).HTMLSelectElement = dom.window.HTMLSelectElement;
  (global as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  (global as any).Event = dom.window.Event;
  (global as any).PointerEvent =
    (dom.window as any).PointerEvent || dom.window.MouseEvent;
  (global as any).MouseEvent = dom.window.MouseEvent;
  (global as any).KeyboardEvent = dom.window.KeyboardEvent;
  (global as any).chrome = {
    storage: {
      local: {
        get: async () => ({ stealthMode: false, autoSubmit: false }),
        set: async () => {},
      },
    },
  };

  return dom;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

async function runTests() {
  console.log(
    "🧪 Starting Aullevo Real-DOM 2D Matrix & FormAnalyzer Test Suite...\n",
  );

  // =========================================================================
  // Test 1: Real DOM McDonald's Availability Table & Personal Info Form
  // =========================================================================
  console.log("--- Test 1: Real HTML McDonald's Availability Table ---");

  const mcdoHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <form id="app-form">
        <div class="field"><label for="f_last">Last Name</label><input id="f_last" type="text" /></div>
        <div class="field"><label for="f_first">First Name</label><input id="f_first" type="text" /></div>
        <div class="field"><label for="f_addr">Present Address</label><input id="f_addr" type="text" /></div>
        <div class="field"><label for="f_phone">Phone No.</label><input id="f_phone" type="text" /></div>

        <div class="section-title">Availability</div>
        <table border="1" id="avail-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Mon</th>
              <th>Tue</th>
              <th>Wed</th>
              <th>Thu</th>
              <th>Fri</th>
              <th>Sat</th>
              <th>Sun</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>From:</td>
              <td><input id="avail_mon_from" type="text" /></td>
              <td><input id="avail_tue_from" type="text" /></td>
              <td><input id="avail_wed_from" type="text" /></td>
              <td><input id="avail_thu_from" type="text" /></td>
              <td><input id="avail_fri_from" type="text" /></td>
              <td><input id="avail_sat_from" type="text" /></td>
              <td><input id="avail_sun_from" type="text" /></td>
            </tr>
            <tr>
              <td>To:</td>
              <td><input id="avail_mon_to" type="text" /></td>
              <td><input id="avail_tue_to" type="text" /></td>
              <td><input id="avail_wed_to" type="text" /></td>
              <td><input id="avail_thu_to" type="text" /></td>
              <td><input id="avail_fri_to" type="text" /></td>
              <td><input id="avail_sat_to" type="text" /></td>
              <td><input id="avail_sun_to" type="text" /></td>
            </tr>
          </tbody>
        </table>
      </form>
    </body>
    </html>
  `;

  setupDom(mcdoHtml);

  // 1. Run actual DOM extraction on the live HTML
  const extractedFields = extractFormFields();
  assert(
    extractedFields.length >= 18,
    `Extracted ${extractedFields.length} fields from real DOM`,
  );

  const monFromField = extractedFields.find((f) => f.id === "avail_mon_from");
  assert(!!monFromField, "Found avail_mon_from in extracted fields");
  assert(
    monFromField?.rowHeader === "From",
    `avail_mon_from rowHeader is "From" (got "${monFromField?.rowHeader}")`,
  );
  assert(
    monFromField?.colHeader === "Mon",
    `avail_mon_from colHeader is "Mon" (got "${monFromField?.colHeader}")`,
  );
  assert(
    monFromField?.compoundLabel === "From — Mon",
    `avail_mon_from compoundLabel is "From — Mon" (got "${monFromField?.compoundLabel}")`,
  );

  const thuToField = extractedFields.find((f) => f.id === "avail_thu_to");
  assert(!!thuToField, "Found avail_thu_to in extracted fields");
  assert(thuToField?.rowHeader === "To", `avail_thu_to rowHeader is "To"`);
  assert(thuToField?.colHeader === "Thu", `avail_thu_to colHeader is "Thu"`);

  // 2. Match with Custom Fields
  const userCustomFields: CustomField[] = [
    {
      label: "Last Name",
      value: "Vicentillo",
      context: "",
    },
    {
      label: "First Name",
      value: "Julle Myth",
      context: "",
    },
    {
      label: "Present Address",
      value: "PMS Bldg Unit 17, Caloocan City",
      context: "",
    },
    {
      label: "Phone",
      value: "09853047403",
      context: "",
    },
    {
      label: "Mon - From",
      value: "8am",
      context: "",
    },
    {
      label: "Mon - To",
      value: "8pm",
      context: "",
    },
    {
      label: "Thu - From",
      value: "10am",
      context: "",
    },
    {
      label: "Thu - To",
      value: "6pm",
      context: "",
    },
  ];

  const emptyUserData: Partial<UserData> = {
    profileType: "custom",
    customFields: userCustomFields,
  };

  const mappings = matchFieldsHeuristically(
    extractedFields,
    userCustomFields,
    emptyUserData,
  );
  await resolveFieldValues(
    mappings,
    extractedFields,
    emptyUserData,
    userCustomFields,
    [],
    false,
  );

  // 3. Fill the real DOM
  for (const m of mappings) {
    if (m.selectedValue !== undefined) {
      await fillFormField(m, m.selectedValue);
    }
  }

  // 4. Verify DOM input values directly
  const domLast = (document.getElementById("f_last") as HTMLInputElement).value;
  const domFirst = (document.getElementById("f_first") as HTMLInputElement)
    .value;
  const domMonFrom = (
    document.getElementById("avail_mon_from") as HTMLInputElement
  ).value;
  const domMonTo = (document.getElementById("avail_mon_to") as HTMLInputElement)
    .value;
  const domThuFrom = (
    document.getElementById("avail_thu_from") as HTMLInputElement
  ).value;
  const domThuTo = (document.getElementById("avail_thu_to") as HTMLInputElement)
    .value;
  const domTueFrom = (
    document.getElementById("avail_tue_from") as HTMLInputElement
  ).value;

  assert(domLast === "Vicentillo", `DOM f_last value is "Vicentillo"`);
  assert(domFirst === "Julle Myth", `DOM f_first value is "Julle Myth"`);
  assert(
    domMonFrom === "8am",
    `DOM avail_mon_from value is "8am" (got "${domMonFrom}")`,
  );
  assert(
    domMonTo === "8pm",
    `DOM avail_mon_to value is "8pm" (got "${domMonTo}")`,
  );
  assert(
    domThuFrom === "10am",
    `DOM avail_thu_from value is "10am" (got "${domThuFrom}")`,
  );
  assert(
    domThuTo === "6pm",
    `DOM avail_thu_to value is "6pm" (got "${domThuTo}")`,
  );
  assert(domTueFrom === "", `DOM avail_tue_from is empty (no bleed)`);

  // =========================================================================
  // Test 2: Real DOM Multiplication Table (e.g. 4 x 9 => 36)
  // =========================================================================
  console.log(
    "\n--- Test 2: Real HTML Multiplication Matrix (4 x 9 => 36) ---",
  );

  let tableRows = "";
  for (let r = 1; r <= 9; r++) {
    let cells = `<th>${r}</th>`;
    for (let c = 1; c <= 9; c++) {
      cells += `<td><input id="cell_${r}_${c}" type="text" /></td>`;
    }
    tableRows += `<tr>${cells}</tr>\n`;
  }

  const multiHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <h2>Multiplication Matrix</h2>
      <table id="multi-table">
        <thead>
          <tr>
            <th>X</th>
            <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </body>
    </html>
  `;

  setupDom(multiHtml);

  const multiFields = extractFormFields();
  assert(multiFields.length === 81, `Extracted 81 cells from 9x9 table`);

  const cell49 = multiFields.find((f) => f.id === "cell_4_9");
  assert(!!cell49, "Found cell_4_9");
  assert(cell49?.rowHeader === "4", `cell_4_9 rowHeader is "4"`);
  assert(cell49?.colHeader === "9", `cell_4_9 colHeader is "9"`);
  assert(
    cell49?.compoundLabel === "4 — 9",
    `cell_4_9 compoundLabel is "4 — 9"`,
  );

  const multiplicationCustomFields: CustomField[] = [
    {
      label: "4 x 9",
      value: "36",
      context: "",
    },
    {
      label: "3 (row) x 7 (column)",
      value: "21",
      context: "",
    },
    {
      label: "Row 5, Col 8",
      value: "40",
      context: "",
    },
    {
      label: "6 * 6",
      value: "36",
      context: "",
    },
    {
      label: "2 by 4",
      value: "8",
      context: "",
    },
    {
      label: "9 x 9",
      value: "81",
      context: "",
    },
  ];

  const multiUserData: Partial<UserData> = {
    profileType: "custom",
    customFields: multiplicationCustomFields,
  };

  const multiMappings = matchFieldsHeuristically(
    multiFields,
    multiplicationCustomFields,
    multiUserData,
  );
  await resolveFieldValues(
    multiMappings,
    multiFields,
    multiUserData,
    multiplicationCustomFields,
    [],
    false,
  );

  for (const m of multiMappings) {
    if (m.selectedValue !== undefined) {
      await fillFormField(m, m.selectedValue);
    }
  }

  const domCell49 = (document.getElementById("cell_4_9") as HTMLInputElement)
    .value;
  const domCell37 = (document.getElementById("cell_3_7") as HTMLInputElement)
    .value;
  const domCell58 = (document.getElementById("cell_5_8") as HTMLInputElement)
    .value;
  const domCell66 = (document.getElementById("cell_6_6") as HTMLInputElement)
    .value;
  const domCell24 = (document.getElementById("cell_2_4") as HTMLInputElement)
    .value;
  const domCell99 = (document.getElementById("cell_9_9") as HTMLInputElement)
    .value;
  const domCell48 = (document.getElementById("cell_4_8") as HTMLInputElement)
    .value;

  assert(
    domCell49 === "36",
    `DOM cell (4 x 9) filled with "36" (got "${domCell49}")`,
  );
  assert(
    domCell37 === "21",
    `DOM cell (3 (row) x 7 (column)) filled with "21" (got "${domCell37}")`,
  );
  assert(
    domCell58 === "40",
    `DOM cell (Row 5, Col 8) filled with "40" (got "${domCell58}")`,
  );
  assert(
    domCell66 === "36",
    `DOM cell (6 * 6) filled with "36" (got "${domCell66}")`,
  );
  assert(
    domCell24 === "8",
    `DOM cell (2 by 4) filled with "8" (got "${domCell24}")`,
  );
  assert(
    domCell99 === "81",
    `DOM cell (9 x 9) filled with "81" (got "${domCell99}")`,
  );
  assert(domCell48 === "", `DOM cell (4 x 8) remains empty`);

  // =========================================================================
  // Test 3: processCustomFields Direct API
  // =========================================================================
  console.log("\n--- Test 3: processCustomFields Direct API ---");

  setupDom(mcdoHtml);
  const filledCount = processCustomFields([
    { label: "Mon - From", value: "9am" },
    { label: "Fri - To", value: "5pm" },
    { label: "First Name", value: "Julle" },
  ]);

  assert(
    filledCount >= 3,
    `processCustomFields filled ${filledCount} fields directly`,
  );
  assert(
    (document.getElementById("avail_mon_from") as HTMLInputElement).value ===
      "9am",
    `avail_mon_from filled to "9am"`,
  );
  assert(
    (document.getElementById("avail_fri_to") as HTMLInputElement).value ===
      "5pm",
    `avail_fri_to filled to "5pm"`,
  );
  assert(
    (document.getElementById("f_first") as HTMLInputElement).value === "Julle",
    `f_first filled to "Julle"`,
  );

  // =========================================================================
  // Test 4: Real DOM 2D Matrix Checkbox Grid (Interview Availability)
  // =========================================================================
  console.log("\n--- Test 4: Real HTML 2D Checkbox Grid ---");

  const checkboxGridHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <table id="interview-grid">
        <thead>
          <tr>
            <th>Day</th>
            <th>Morning</th>
            <th>Afternoon</th>
            <th>Evening</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Mon</th>
            <td><input id="cb_mon_morn" type="checkbox" /></td>
            <td><input id="cb_mon_after" type="checkbox" /></td>
            <td><input id="cb_mon_eve" type="checkbox" /></td>
          </tr>
          <tr>
            <th>Tue</th>
            <td><input id="cb_tue_morn" type="checkbox" /></td>
            <td><input id="cb_tue_after" type="checkbox" /></td>
            <td><input id="cb_tue_eve" type="checkbox" /></td>
          </tr>
          <tr>
            <th>Wed</th>
            <td><input id="cb_wed_morn" type="checkbox" /></td>
            <td><input id="cb_wed_after" type="checkbox" /></td>
            <td><input id="cb_wed_eve" type="checkbox" /></td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `;

  setupDom(checkboxGridHtml);

  const cbFields = extractFormFields();
  const cbCustomFields: CustomField[] = [
    {
      label: "Mon - Morning",
      value: "Yes",
      context: "",
    },
    {
      label: "Mon - Evening",
      value: "true",
      context: "",
    },
    {
      label: "Wed - Afternoon",
      value: "on",
      context: "",
    },
  ];

  const cbUserData: Partial<UserData> = {
    profileType: "custom",
    customFields: cbCustomFields,
  };

  const cbMappings = matchFieldsHeuristically(
    cbFields,
    cbCustomFields,
    cbUserData,
  );
  await resolveFieldValues(
    cbMappings,
    cbFields,
    cbUserData,
    cbCustomFields,
    [],
    false,
  );

  for (const m of cbMappings) {
    if (m.selectedValue !== undefined) {
      await fillFormField(m, m.selectedValue);
    }
  }

  assert(
    (document.getElementById("cb_mon_morn") as HTMLInputElement).checked ===
      true,
    "Mon Morning checkbox checked",
  );
  assert(
    (document.getElementById("cb_mon_eve") as HTMLInputElement).checked ===
      true,
    "Mon Evening checkbox checked",
  );
  assert(
    (document.getElementById("cb_wed_after") as HTMLInputElement).checked ===
      true,
    "Wed Afternoon checkbox checked",
  );
  assert(
    (document.getElementById("cb_mon_after") as HTMLInputElement).checked ===
      false,
    "Mon Afternoon checkbox unchecked",
  );
  assert(
    (document.getElementById("cb_tue_morn") as HTMLInputElement).checked ===
      false,
    "Tue Morning checkbox unchecked",
  );

  console.log(
    "\n🎉 ALL REAL-DOM 2D MATRIX & FORMANALYZER TESTS PASSED WITH 100% SUCCESS! 🚀\n",
  );
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
