import { matchFieldsHeuristically } from "./src/services/heuristicMatcher";
import { resolveFieldValues } from "./src/background/modules/fieldResolver";
import type { FormField, CustomField, UserData } from "./src/types";

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
    "🧪 Starting Aullevo Comprehensive Matrix & Heuristic Test Suite...\n",
  );

  // =========================================================================
  // Test 1: McDonald's Application (User's Exact HTML & Custom Fields from Screenshot)
  // =========================================================================
  console.log("--- Test 1: McDonald's Form & Availability Table ---");
  const userCustomFields: CustomField[] = [
    { label: "Last Name", value: "Vicentillo", context: "Last Name" },
    { label: "First Name", value: "Julle Myth", context: "First Name" },
    {
      label: "Present Address",
      value: "PMS Bldg Unit 17, Caloocan City",
      context: "Present Address",
    },
    { label: "Phone", value: "09853047403", context: "Phone" },
    { label: "Mon - From", value: "8am", context: "Mon - From" },
    { label: "Mon - To", value: "8pm", context: "Mon - To" },
    { label: "Thu - From", value: "10am", context: "Thu - From" },
    { label: "Thu - To", value: "6pm", context: "Thu - To" },
  ];

  const emptyUserData: Partial<UserData> = {
    profileType: "custom",
    customFields: userCustomFields,
  };

  const mcdoFields: FormField[] = [
    {
      id: "f_last",
      name: "",
      type: "text",
      placeholder: "",
      label: "Last Name",
      ariaLabel: "",
      autocomplete: "",
      required: true,
      context: "Personal Information",
    },
    {
      id: "f_first",
      name: "",
      type: "text",
      placeholder: "",
      label: "First Name",
      ariaLabel: "",
      autocomplete: "",
      required: true,
      context: "Personal Information",
    },
    {
      id: "f_middle",
      name: "",
      type: "text",
      placeholder: "",
      label: "Middle",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      context: "Personal Information",
    },
    {
      id: "f_addr",
      name: "",
      type: "text",
      placeholder: "Street Address, City, Province",
      label: "Present Address",
      ariaLabel: "",
      autocomplete: "",
      required: true,
      context: "Personal Information",
    },
    {
      id: "f_phone",
      name: "",
      type: "text",
      placeholder: "e.g. Phone Number",
      label: "Phone No.",
      ariaLabel: "",
      autocomplete: "",
      required: true,
      context: "Personal Information",
    },
    {
      id: "f_pos",
      name: "",
      type: "text",
      placeholder: "e.g., Crew Member",
      label: "Position Applied For",
      ariaLabel: "",
      autocomplete: "",
      required: true,
      context: "Personal Information",
    },
    {
      id: "f_ref",
      name: "",
      type: "text",
      placeholder: "",
      label: "Referred By",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      context: "Personal Information",
    },
    {
      id: "f_avail_date",
      name: "",
      type: "date",
      placeholder: "",
      label: "Date of Availability",
      ariaLabel: "",
      autocomplete: "",
      required: true,
      context: "Personal Information",
    },
    {
      id: "employed",
      name: "employed",
      type: "radio_group",
      placeholder: "",
      label: "Are you presently employed?",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    },
    {
      id: "mcd_past",
      name: "mcd_past",
      type: "radio_group",
      placeholder: "",
      label: "Have you ever worked for McDonald's before?",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    },
  ];

  // Add 2D Availability table cells: 7 columns x 2 rows (From: / To:)
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const day of days) {
    mcdoFields.push({
      id: `avail_${day}_from`,
      name: "",
      type: "text",
      placeholder: "8am",
      label: `${day} — From`,
      ariaLabel: "",
      autocomplete: "",
      required: false,
      rowHeader: "From",
      colHeader: day,
      compoundLabel: `${day} — From`,
      context: "Availability",
    });
    mcdoFields.push({
      id: `avail_${day}_to`,
      name: "",
      type: "text",
      placeholder: "4pm",
      label: `${day} — To`,
      ariaLabel: "",
      autocomplete: "",
      required: false,
      rowHeader: "To",
      colHeader: day,
      compoundLabel: `${day} — To`,
      context: "Availability",
    });
  }

  const mappings1 = matchFieldsHeuristically(
    mcdoFields,
    userCustomFields,
    emptyUserData,
  );
  await resolveFieldValues(
    mappings1,
    mcdoFields,
    emptyUserData,
    userCustomFields,
    [],
    false,
  );

  const getVal1 = (id: string) =>
    mappings1.find((m) => m.id === id || m.fieldId === id)?.selectedValue;
  const getType1 = (id: string) =>
    mappings1.find((m) => m.id === id || m.fieldId === id)?.fieldType;

  assert(getType1("f_last") === "lastName", "Last Name mapped to lastName");
  assert(
    getVal1("f_last") === "Vicentillo",
    'Last Name resolved to "Vicentillo"',
  );

  assert(getType1("f_first") === "firstName", "First Name mapped to firstName");
  assert(
    getVal1("f_first") === "Julle Myth",
    'First Name resolved to "Julle Myth"',
  );

  assert(getType1("f_addr") === "address", "Present Address mapped to address");
  assert(
    getVal1("f_addr") === "PMS Bldg Unit 17, Caloocan City",
    "Present Address resolved from custom profile",
  );

  assert(getType1("f_phone") === "phone", "Phone No. mapped to phone");
  assert(
    getVal1("f_phone") === "09853047403",
    'Phone No. resolved to "09853047403"',
  );

  // Availability matrix coordinate resolutions:
  assert(getVal1("avail_Mon_from") === "8am", 'Mon - From resolved to "8am"');
  assert(getVal1("avail_Mon_to") === "8pm", 'Mon - To resolved to "8pm"');
  assert(getVal1("avail_Thu_from") === "10am", 'Thu - From resolved to "10am"');
  assert(getVal1("avail_Thu_to") === "6pm", 'Thu - To resolved to "6pm"');

  // Verify non-specified days are completely EMPTY:
  assert(
    !getVal1("avail_Tue_from"),
    "Tue - From is EMPTY (no bleeding from Mon!)",
  );
  assert(!getVal1("avail_Tue_to"), "Tue - To is EMPTY");
  assert(!getVal1("avail_Wed_from"), "Wed - From is EMPTY");
  assert(!getVal1("avail_Wed_to"), "Wed - To is EMPTY");
  assert(!getVal1("avail_Fri_from"), "Fri - From is EMPTY");
  assert(!getVal1("avail_Sat_from"), "Sat - From is EMPTY");
  assert(!getVal1("avail_Sun_from"), "Sun - From is EMPTY");

  // =========================================================================
  // Test 2: 2D Matrix Checkbox Grid (Image 4 "Interview Availability")
  // =========================================================================
  console.log(
    "\n--- Test 2: 2D Matrix Checkbox Grid (Interview Availability) ---",
  );
  const interviewCustomFields: CustomField[] = [
    { label: "Mon - Morning", value: "Yes", context: "Mon - Morning" },
    { label: "Mon - Evening", value: "Yes", context: "Mon - Evening" },
    { label: "Thu - Afternoon", value: "Yes", context: "Thu - Afternoon" },
  ];

  const interviewFields: FormField[] = [];
  const interviewDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const slots = ["Morning", "Afternoon", "Evening"];

  for (const day of interviewDays) {
    for (const slot of slots) {
      interviewFields.push({
        id: `grid_${day}_${slot}`,
        name: "",
        type: "checkbox",
        placeholder: "",
        label: `${day} — ${slot}`,
        ariaLabel: "",
        autocomplete: "",
        required: false,
        rowHeader: day,
        colHeader: slot,
        compoundLabel: `${day} — ${slot}`,
        context: "Interview Availability",
      });
    }
  }

  const mappings2 = matchFieldsHeuristically(
    interviewFields,
    interviewCustomFields,
    emptyUserData,
  );
  await resolveFieldValues(
    mappings2,
    interviewFields,
    emptyUserData,
    interviewCustomFields,
    [],
    false,
  );

  const getVal2 = (id: string) =>
    mappings2.find((m) => m.id === id || m.fieldId === id)?.selectedValue;

  assert(
    getVal2("grid_Mon_Morning") === "Yes",
    'Mon — Morning checkbox matched and resolved to "Yes"',
  );
  assert(
    getVal2("grid_Mon_Evening") === "Yes",
    'Mon — Evening checkbox matched and resolved to "Yes"',
  );
  assert(
    getVal2("grid_Thu_Afternoon") === "Yes",
    'Thu — Afternoon checkbox matched and resolved to "Yes"',
  );

  // Verify other checkboxes remain unmapped / empty:
  assert(!getVal2("grid_Mon_Afternoon"), "Mon — Afternoon is unchecked");
  assert(!getVal2("grid_Tue_Morning"), "Tue — Morning is unchecked");
  assert(!getVal2("grid_Tue_Afternoon"), "Tue — Afternoon is unchecked");
  assert(!getVal2("grid_Wed_Morning"), "Wed — Morning is unchecked");
  assert(!getVal2("grid_Fri_Evening"), "Fri — Evening is unchecked");

  // =========================================================================
  // Test 3: Complex 2D Matrix Tokens & 1D Layer Complete Isolation
  // =========================================================================
  console.log(
    "\n--- Test 3: Complex 2D Matrix Tokens & 1D Layer Isolation ---",
  );
  const complexCustomFields: CustomField[] = [
    { label: "Full Name", value: "Alex Morgan", context: "Full Name" },
    { label: "Email Address", value: "alex@example.com", context: "Email" },
    { label: "Mon - From", value: "9am", context: "Mon - From" },
    { label: "Wed / From", value: "10am", context: "Wed / From" },
    { label: "Fri — To", value: "5pm", context: "Fri — To" },
    { label: "Sat: To", value: "11pm", context: "Sat: To" },
  ];

  const mixedFields: FormField[] = [
    {
      id: "f_fullname",
      name: "fullname",
      type: "text",
      placeholder: "Your name",
      label: "Full Name",
      ariaLabel: "",
      autocomplete: "name",
      required: true,
      context: "Personal Info",
    },
    {
      id: "f_email",
      name: "email",
      type: "email",
      placeholder: "name@example.com",
      label: "Email Address",
      ariaLabel: "",
      autocomplete: "email",
      required: true,
      context: "Personal Info",
    },
    {
      id: "avail_Mon_from",
      name: "m_from",
      type: "text",
      placeholder: "e.g. 9am",
      label: "Mon — From",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      rowHeader: "From",
      colHeader: "Mon",
      compoundLabel: "Mon — From",
      context: "Availability Grid",
    },
    {
      id: "avail_Wed_from",
      name: "w_from",
      type: "text",
      placeholder: "",
      label: "Wed — From",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      rowHeader: "From",
      colHeader: "Wed",
      compoundLabel: "Wed — From",
      context: "Availability Grid",
    },
    {
      id: "avail_Fri_to",
      name: "f_to",
      type: "text",
      placeholder: "",
      label: "Fri — To",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      rowHeader: "To",
      colHeader: "Fri",
      compoundLabel: "Fri — To",
      context: "Availability Grid",
    },
    {
      id: "avail_Sat_to",
      name: "s_to",
      type: "text",
      placeholder: "",
      label: "Sat — To",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      rowHeader: "To",
      colHeader: "Sat",
      compoundLabel: "Sat — To",
      context: "Availability Grid",
    },
    {
      id: "avail_Sun_to",
      name: "sun_to",
      type: "text",
      placeholder: "",
      label: "Sun — To",
      ariaLabel: "",
      autocomplete: "",
      required: false,
      rowHeader: "To",
      colHeader: "Sun",
      compoundLabel: "Sun — To",
      context: "Availability Grid",
    },
  ];

  const mappings3 = matchFieldsHeuristically(
    mixedFields,
    complexCustomFields,
    emptyUserData,
  );
  await resolveFieldValues(
    mappings3,
    mixedFields,
    emptyUserData,
    complexCustomFields,
    [],
    false,
  );

  const getVal3 = (id: string) =>
    mappings3.find((m) => m.id === id || m.fieldId === id)?.selectedValue;
  const getType3 = (id: string) =>
    mappings3.find((m) => m.id === id || m.fieldId === id)?.fieldType;

  // 1D Field validation
  assert(getType3("f_fullname") === "fullName", "1D Full Name preserved as fullName");
  assert(getVal3("f_fullname") === "Alex Morgan", "1D Full Name resolved correctly");
  assert(getType3("f_email") === "email", "1D Email preserved as email");
  assert(getVal3("f_email") === "alex@example.com", "1D Email resolved correctly");

  // 2D Matrix Field with special tokens
  assert(getVal3("avail_Mon_from") === "9am", 'Hyphenated token "Mon - From" resolved to "9am"');
  assert(getVal3("avail_Wed_from") === "10am", 'Slash token "Wed / From" resolved to "10am"');
  assert(getVal3("avail_Fri_to") === "5pm", 'Em-dash token "Fri — To" resolved to "5pm"');
  assert(getVal3("avail_Sat_to") === "11pm", 'Colon token "Sat: To" resolved to "11pm"');
  assert(!getVal3("avail_Sun_to"), "Unset matrix cell Sun — To remains empty");

  console.log("\n🎉 ALL 1D AND 2D MATRIX TESTS PASSED WITH 100% SUCCESS! 🚀");
}

runTests().catch((err) => {
  console.error("Fatal error during test run:", err);
  process.exit(1);
});

