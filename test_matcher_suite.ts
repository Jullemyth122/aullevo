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

  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.Event = dom.window.Event;
  g.InputEvent = dom.window.InputEvent || dom.window.Event;
  const domWin = dom.window as unknown as Record<string, unknown>;
  g.PointerEvent = domWin.PointerEvent || dom.window.MouseEvent;
  g.MouseEvent = dom.window.MouseEvent;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.FocusEvent = domWin.FocusEvent || dom.window.UIEvent || dom.window.Event;
  g.chrome = {
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
        <div class="section-title">Personal Information</div>
        <div class="field"><label for="f_last">LAST NAME</label><input id="f_last" type="text" /></div>
        <div class="field"><label for="f_first">FIRST NAME</label><input id="f_first" type="text" /></div>
        <div class="field"><label for="f_middle">MIDDLE</label><input id="f_middle" type="text" /></div>
        <div class="field"><label for="f_addr">PRESENT ADDRESS</label><input id="f_addr" type="text" /></div>
        <div class="field"><label for="f_phone">PHONE NO.</label><input id="f_phone" type="text" /></div>

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

        <div class="section-title">Employment Background</div>
        <p>List your present or last position first.</p>
        <table border="1" id="emp-table">
          <thead>
            <tr>
              <th>From / To</th>
              <th>Company Name</th>
              <th>Supervisor</th>
              <th>Your Position</th>
              <th>Reason for Leaving</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><input id="emp_1_dates" type="text" /></td>
              <td><input id="emp_1_company" type="text" /></td>
              <td><input id="emp_1_supervisor" type="text" /></td>
              <td><input id="emp_1_position" type="text" /></td>
              <td><input id="emp_1_reason" type="text" /></td>
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

  const domMiddle = (document.getElementById("f_middle") as HTMLInputElement)
    .value;
  const domEmpDates = (
    document.getElementById("emp_1_dates") as HTMLInputElement
  ).value;
  const domEmpCompany = (
    document.getElementById("emp_1_company") as HTMLInputElement
  ).value;

  assert(domLast === "Vicentillo", `DOM f_last value is "Vicentillo"`);
  assert(
    domFirst === "Julle Myth",
    `DOM f_first value is "Julle Myth" (not Vicentillo)`,
  );
  assert(domMiddle === "", `DOM f_middle is empty (no bleed from Last Name)`);
  assert(
    domEmpDates === "",
    `DOM emp_1_dates is empty (no bleed from First Name)`,
  );
  assert(
    domEmpCompany === "",
    `DOM emp_1_company is empty (no bleed from First Name)`,
  );
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

  // =========================================================================
  // Test 5: Real Google Forms DOM (Salutation Radio Group & Residential Address Input)
  // =========================================================================
  console.log(
    "\n--- Test 5: Real Google Forms HTML (Salutation Radio & Residential Address) ---",
  );

  const googleFormsHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <form id="google-form">
        <!-- Question 1: Salutation (for official documents) -->
        <div class="Qr70ae" role="listitem">
          <div jsmodel="CP1oW" data-params="%.@.[32844792,&quot;Salutation (for official documents)&quot;,null,2,[[1175070719,[[&quot;Mr.&quot;,null,null,null,false],[&quot;Ms.&quot;,null,null,null,false]],true]],&quot;i11&quot;,&quot;i12&quot;,&quot;i13&quot;,false,&quot;i14&quot;]">
            <div jscontroller="sWGJ4b" class="geS5n">
              <div role="heading" id="i11" class="M7eMe">Salutation (for official documents) *</div>
              <div role="radiogroup" aria-labelledby="i11" class="SGdaJf">
                <div class="docssharedwizToggleLabeledContainer">
                  <div id="radio_mr" class="bz0duf" role="radio" aria-checked="false" aria-label="Mr." data-value="Mr." tabindex="0"></div>
                  <div class="aDTYNe"><span class="M7eMe">Mr.</span></div>
                </div>
                <div class="docssharedwizToggleLabeledContainer">
                  <div id="radio_ms" class="bz0duf" role="radio" aria-checked="false" aria-label="Ms." data-value="Ms." tabindex="0"></div>
                  <div class="aDTYNe"><span class="M7eMe">Ms.</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Question 2: Residential Address -->
        <div class="Qr70ae" role="listitem">
          <div jsmodel="CP1oW" data-params="%.@.[1722618097,&quot;Residential Address&quot;,&quot;Please enter your complete address&quot;,1,[[474404801,null,true]],&quot;i22&quot;,&quot;i23&quot;,&quot;i24&quot;,false,&quot;i25&quot;]">
            <div class="geS5n">
              <div role="heading" id="i22" class="M7eMe">Residential Address *</div>
              <div id="i23" class="description">Please enter your complete address, using proper capitalization</div>
              <input id="input_address" type="text" class="whsOnd zHQkBf" jsname="YPqjbf" autocomplete="off" tabindex="0" aria-labelledby="i22" aria-describedby="i23 i24" data-initial-value="" />
            </div>
          </div>
        </div>
      </form>
    </body>
    </html>
  `;

  setupDom(googleFormsHtml);

  const gfFields = extractFormFields();
  assert(
    gfFields.length >= 2,
    `Extracted ${gfFields.length} fields from Google Forms DOM`,
  );

  const salutationField = gfFields.find((f) =>
    f.label.toLowerCase().includes("salutation"),
  );
  assert(
    !!salutationField,
    `Found Salutation field: "${salutationField?.label}"`,
  );
  assert(
    salutationField?.type === "radio_group",
    `Salutation field type is "radio_group" (got "${salutationField?.type}")`,
  );
  assert(
    (salutationField?.options || []).length === 2,
    `Salutation has 2 radio options (got ${salutationField?.options?.length})`,
  );

  const addressField = gfFields.find((f) =>
    f.label.toLowerCase().includes("residential address"),
  );
  assert(
    !!addressField,
    `Found Residential Address field: "${addressField?.label}"`,
  );

  const gfCustomFields: CustomField[] = [
    {
      label: "Salutation",
      value: "Mr",
      context: "Salutation",
    },
    {
      label: "Residential Address",
      value: "PMS Bldg Unit 17 Brgy 186 Tala Caloocan City",
      context: "Residential Address",
    },
  ];

  const gfUserData: Partial<UserData> = {
    profileType: "custom",
    customFields: gfCustomFields,
  };

  const gfMappings = matchFieldsHeuristically(
    gfFields,
    gfCustomFields,
    gfUserData,
  );
  await resolveFieldValues(
    gfMappings,
    gfFields,
    gfUserData,
    gfCustomFields,
    [],
    false,
  );

  for (const m of gfMappings) {
    if (m.selectedValue !== undefined) {
      await fillFormField(m, m.selectedValue);
    }
  }

  const mrRadio = document.getElementById("radio_mr");
  const msRadio = document.getElementById("radio_ms");
  const addrInput = document.getElementById(
    "input_address",
  ) as HTMLInputElement;

  assert(
    mrRadio?.getAttribute("aria-checked") === "true" ||
      mrRadio?.classList.contains("selected"),
    'Google Forms "Mr." radio selected',
  );
  assert(
    msRadio?.getAttribute("aria-checked") === "false",
    'Google Forms "Ms." radio not selected',
  );
  assert(
    addrInput.value === "PMS Bldg Unit 17 Brgy 186 Tala Caloocan City",
    `Google Forms address input filled (got "${addrInput.value}")`,
  );

  // Test 5b: Long Prompt Pasted into Custom Field Label
  const gfLongPromptCustomFields: CustomField[] = [
    {
      label:
        'Residential Address * Please enter your complete address, using proper capitalization (e.g., "Blk 12, Lot 5, Phase 2, Sunrise Homes, Antipolo City")',
      value: "PMS Bldg Unit 17 Tala Caloocan",
      context:
        'Residential Address * Please enter your complete address, using proper capitalization (e.g., "Blk 12, Lot 5, Phase 2, Sunrise Homes, Antipolo City")',
    },
  ];

  const gfLongPromptMappings = matchFieldsHeuristically(
    gfFields,
    gfLongPromptCustomFields,
    { profileType: "custom", customFields: gfLongPromptCustomFields },
  );
  await resolveFieldValues(
    gfLongPromptMappings,
    gfFields,
    { profileType: "custom", customFields: gfLongPromptCustomFields },
    gfLongPromptCustomFields,
    [],
    false,
  );

  const addressMappingLong = gfLongPromptMappings.find(
    (m) => (m.id || m.fieldId) === "input_address",
  );
  assert(
    addressMappingLong?.selectedValue === "PMS Bldg Unit 17 Tala Caloocan",
    `Long prompt custom field resolved value correctly (got "${addressMappingLong?.selectedValue}")`,
  );

  // =========================================================================
  // Test 6: Multi-Column Table Layout Without 'for' Attributes (Personal Info Grid)
  // =========================================================================
  console.log("\n--- Test 6: Multi-Column Table Layout Without 'for' Attributes ---");

  const tableFormHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <form id="table-app-form">
        <table>
          <tr>
            <th>LAST NAME</th>
            <th>FIRST NAME</th>
            <th>MIDDLE</th>
          </tr>
          <tr>
            <td><input id="tbl_last" type="text" /></td>
            <td><input id="tbl_first" type="text" /></td>
            <td><input id="tbl_middle" type="text" /></td>
          </tr>
          <tr>
            <th colspan="2">PRESENT ADDRESS</th>
            <th>PHONE NO.</th>
          </tr>
          <tr>
            <td colspan="2"><input id="tbl_addr" type="text" /></td>
            <td><input id="tbl_phone" type="text" placeholder="e.g. Phone Number" /></td>
          </tr>
        </table>
      </form>
    </body>
    </html>
  `;

  setupDom(tableFormHtml);

  const tblFields = extractFormFields();
  assert(tblFields.length === 5, `Extracted 5 fields from table form (got ${tblFields.length})`);

  const tblLastField = tblFields.find((f) => f.id === "tbl_last");
  const tblFirstField = tblFields.find((f) => f.id === "tbl_first");
  const tblMiddleField = tblFields.find((f) => f.id === "tbl_middle");
  const tblAddrField = tblFields.find((f) => f.id === "tbl_addr");
  const tblPhoneField = tblFields.find((f) => f.id === "tbl_phone");

  assert(tblLastField?.label === "LAST NAME", `tbl_last label is "LAST NAME" (got "${tblLastField?.label}")`);
  assert(tblFirstField?.label === "FIRST NAME", `tbl_first label is "FIRST NAME" (got "${tblFirstField?.label}")`);
  assert(tblMiddleField?.label === "MIDDLE", `tbl_middle label is "MIDDLE" (got "${tblMiddleField?.label}")`);
  assert(tblAddrField?.label === "PRESENT ADDRESS", `tbl_addr label is "PRESENT ADDRESS" (got "${tblAddrField?.label}")`);
  assert(tblPhoneField?.label === "PHONE NO.", `tbl_phone label is "PHONE NO." (got "${tblPhoneField?.label}")`);

  const tblCustomFields: CustomField[] = [
    { label: "Last Name", value: "Vicentillo", context: "Last Name" },
    { label: "First Name", value: "Julle Myth", context: "First Name" },
    { label: "Phone", value: "09853047403", context: "Phone" },
    { label: "Residential Address", value: "PMS BLDG Unit 17 Brgy 186 Tala Caloocan City", context: "Residential Address" },
    { label: "Salutation", value: "Mr", context: "Salutation" },
    { label: "Email", value: "mythicalxenon12@gmail.com", context: "Email" }
  ];

  const tblUserData: Partial<UserData> = {
    profileType: "custom",
    customFields: tblCustomFields,
  };

  const tblMappings = matchFieldsHeuristically(tblFields, tblCustomFields, tblUserData);
  await resolveFieldValues(tblMappings, tblFields, tblUserData, tblCustomFields, [], false);

  for (const m of tblMappings) {
    if (m.selectedValue !== undefined) {
      await fillFormField(m, m.selectedValue);
    }
  }

  const domTblLast = (document.getElementById("tbl_last") as HTMLInputElement).value;
  const domTblFirst = (document.getElementById("tbl_first") as HTMLInputElement).value;
  const domTblMiddle = (document.getElementById("tbl_middle") as HTMLInputElement).value;
  const domTblAddr = (document.getElementById("tbl_addr") as HTMLInputElement).value;
  const domTblPhone = (document.getElementById("tbl_phone") as HTMLInputElement).value;

  assert(domTblLast === "Vicentillo", `Table Last Name filled "Vicentillo" (got "${domTblLast}")`);
  assert(domTblFirst === "Julle Myth", `Table First Name filled "Julle Myth" (got "${domTblFirst}")`);
  assert(domTblMiddle === "", `Table Middle Name remains empty (no bleed from Last Name) (got "${domTblMiddle}")`);
  assert(domTblAddr === "PMS BLDG Unit 17 Brgy 186 Tala Caloocan City", `Table Present Address filled correctly (got "${domTblAddr}")`);
  assert(domTblPhone === "09853047403", `Table Phone Number filled "09853047403" (got "${domTblPhone}")`);

  // =========================================================================
  // Test 7: Real Google Forms Structure (Heading extraction, whsOnd, radios, paragraphs)
  // =========================================================================
  console.log("\n--- Test 7: Real Google Forms Container-First Injection ---");

  const googleFormsInternHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>Intern Information Form</title></head>
    <body>
      <form>
        <div class="Qr7Oae" role="listitem">
          <div class="geS5n">
            <div class="M7eMe" role="heading">First Name *</div>
            <div class="AgroD">
              <input type="text" class="whsOnd" name="entry.1001" id="gf_fname" />
            </div>
          </div>
        </div>

        <div class="Qr7Oae" role="listitem">
          <div class="geS5n">
            <div class="M7eMe" role="heading">Surname/Last Name *</div>
            <div class="AgroD">
              <input type="text" class="whsOnd" name="entry.1002" id="gf_lname" />
            </div>
          </div>
        </div>

        <div class="Qr7Oae" role="listitem">
          <div class="geS5n">
            <div class="M7eMe" role="heading">Salutation (for official docu</div>
            <div class="radios-wrap">
              <div class="docssharedWizToggleLabeledContainer">
                <div role="radio" aria-checked="false" aria-label="Mr." id="gf_radio_mr"></div>
                <span class="aDTYNe">Mr.</span>
              </div>
              <div class="docssharedWizToggleLabeledContainer">
                <div role="radio" aria-checked="false" aria-label="Ms." id="gf_radio_ms"></div>
                <span class="aDTYNe">Ms.</span>
              </div>
            </div>
          </div>
        </div>

        <div class="Qr7Oae" role="listitem">
          <div class="geS5n">
            <div class="M7eMe" role="heading">Residential Address *</div>
            <div class="AgroD">
              <textarea class="KHxj8b" name="entry.1003" id="gf_addr"></textarea>
            </div>
          </div>
        </div>
      </form>
    </body>
    </html>
  `;

  setupDom(googleFormsInternHtml);

  const gfInternFields = extractFormFields();
  assert(gfInternFields.length >= 4, `Google Forms: Extracted at least 4 fields (got ${gfInternFields.length})`);

  const gfFirstField = gfInternFields.find((f) => f.label.toLowerCase().includes("first name"));
  const gfLastField = gfInternFields.find((f) => f.label.toLowerCase().includes("surname") || f.label.toLowerCase().includes("last name"));
  const gfSalutationField = gfInternFields.find((f) => f.label.toLowerCase().includes("salutation"));
  const gfAddrField = gfInternFields.find((f) => f.label.toLowerCase().includes("address"));

  assert(!!gfFirstField, `Google Forms: Successfully extracted "First Name" field (label: "${gfFirstField?.label}")`);
  assert(!!gfLastField, `Google Forms: Successfully extracted "Surname/Last Name" field (label: "${gfLastField?.label}")`);
  assert(!!gfSalutationField, `Google Forms: Successfully extracted "Salutation" radio group (label: "${gfSalutationField?.label}")`);
  assert(!!gfAddrField, `Google Forms: Successfully extracted "Residential Address" field (label: "${gfAddrField?.label}")`);

  const gfInternUserData: Partial<UserData> = {
    firstName: "Vicentillo",
    lastName: "Nigga",
    address: "Nigga What?",
    customFields: [
      { label: "Salutation", value: "Mr.", context: "Salutation" },
      { label: "Residential Address", value: "Nigga What?", context: "Residential Address" }
    ]
  };

  const gfInternMappings = matchFieldsHeuristically(gfInternFields, gfInternUserData.customFields, gfInternUserData);
  await resolveFieldValues(gfInternMappings, gfInternFields, gfInternUserData, gfInternUserData.customFields, [], false);

  for (const m of gfInternMappings) {
    if (m.selectedValue !== undefined) {
      await fillFormField(m, m.selectedValue);
    }
  }

  const domGfFirst = (document.getElementById("gf_fname") as HTMLInputElement).value;
  const domGfLast = (document.getElementById("gf_lname") as HTMLInputElement).value;
  const domGfAddr = (document.getElementById("gf_addr") as HTMLTextAreaElement).value;
  const domGfRadioMrChecked = document.getElementById("gf_radio_mr")?.getAttribute("aria-checked") === "true";

  assert(domGfFirst === "Vicentillo", `Google Forms: First Name filled "Vicentillo" (got "${domGfFirst}")`);
  assert(domGfLast === "Nigga", `Google Forms: Last Name filled "Nigga" (got "${domGfLast}")`);
  assert(domGfAddr === "Nigga What?", `Google Forms: Address filled "Nigga What?" (got "${domGfAddr}")`);
  assert(domGfRadioMrChecked, `Google Forms: Salutation Mr. radio selected (got aria-checked="${document.getElementById("gf_radio_mr")?.getAttribute("aria-checked")}")`);

  console.log(
    "\n🎉 ALL REAL-DOM 2D MATRIX, GOOGLE FORMS, & FORMANALYZER TESTS PASSED WITH 100% SUCCESS! 🚀\n",
  );
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
