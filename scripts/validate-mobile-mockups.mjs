import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { chromium } from "playwright";

const mockupPath = new URL("../docs/mobile-mockups.html", import.meta.url);
const html = await readFile(mockupPath, "utf8");
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const script = inlineScripts.at(-1)?.[1];

if (!script) {
  throw new Error("The mobile mockup has no inline application script.");
}

const dictionarySource =
  script.slice(script.indexOf("const copy ="), script.indexOf("const screens =")) +
  "\nglobalThis.__copy = copy;";
const dictionaryContext = {};
vm.runInNewContext(dictionarySource, dictionaryContext);

const dictionaries = dictionaryContext.__copy;
const languages = Object.keys(dictionaries);
const referenceKeys = Object.keys(dictionaries.ru).sort();

for (const language of languages) {
  const keys = Object.keys(dictionaries[language]).sort();
  const missing = referenceKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !referenceKeys.includes(key));

  if (missing.length || extra.length) {
    throw new Error(
      `${language} dictionary parity failed; missing=${missing.join(",")}; extra=${extra.join(",")}`,
    );
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1100, height: 656 },
  deviceScaleFactor: 1,
});
const browserErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

const fileUrl = mockupPath.href;

try {
  await page.goto(
    `${fileUrl}?screen=inspections&state=active&role=warehouse&lang=ru&width=320&long=1`,
    { waitUntil: "load" },
  );

  const layout = await page.evaluate(() => {
    const failures = [];
    const roles = ["warehouse", "employee", "admin", "owner"];
    const languagesToCheck = ["ru", "kk", "en"];
    const dispatchChange = (element) =>
      element.dispatchEvent(new Event("change", { bubbles: true }));
    const screen = document.querySelector("#screen");
    const state = document.querySelector("#state");
    const role = document.querySelector("#role");
    const language = document.querySelector("#language");
    const longCopy = document.querySelector("#long-copy");

    document.querySelector('[data-width="320"]').click();
    longCopy.checked = true;
    dispatchChange(longCopy);

    let checked = 0;
    let minTarget = Number.POSITIVE_INFINITY;

    for (const languageValue of languagesToCheck) {
      language.value = languageValue;
      dispatchChange(language);

      for (const screenValue of [...screen.options].map((option) => option.value)) {
        screen.value = screenValue;
        dispatchChange(screen);

        for (const stateValue of [...state.options].map((option) => option.value)) {
          state.value = stateValue;
          dispatchChange(state);

          for (const roleValue of roles) {
            role.value = roleValue;
            dispatchChange(role);

            const phone = document.querySelector(".phone");
            const device = document.querySelector(".device");
            const phoneRect = phone.getBoundingClientRect();
            const deviceRect = device.getBoundingClientRect();
            const innerTop = deviceRect.top + device.clientTop;
            const innerBottom = innerTop + device.clientHeight;

            if (phone.clientWidth !== 320 || phone.clientHeight !== 568) {
              failures.push({
                kind: "viewport",
                languageValue,
                screenValue,
                stateValue,
                roleValue,
                width: phone.clientWidth,
                height: phone.clientHeight,
              });
            }
            if (phone.scrollWidth > phone.clientWidth + 1) {
              failures.push({
                kind: "horizontal-overflow",
                languageValue,
                screenValue,
                stateValue,
                roleValue,
              });
            }

            for (const element of phone.querySelectorAll("button,input,select,textarea")) {
              const rect = element.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              minTarget = Math.min(minTarget, rect.width, rect.height);

              if (rect.width < 43.5 || rect.height < 43.5) {
                failures.push({
                  kind: "touch-target",
                  languageValue,
                  screenValue,
                  stateValue,
                  roleValue,
                  tag: element.tagName,
                  width: rect.width,
                  height: rect.height,
                });
              }
              if (rect.left < phoneRect.left - 1 || rect.right > phoneRect.right + 1) {
                failures.push({
                  kind: "clipped-control",
                  languageValue,
                  screenValue,
                  stateValue,
                  roleValue,
                });
              }
            }

            const footer = document.querySelector(".phone-footer");
            if (footer) {
              const rect = footer.getBoundingClientRect();
              if (rect.top < innerTop - 1 || rect.bottom > innerBottom + 1) {
                failures.push({
                  kind: "clipped-footer",
                  languageValue,
                  screenValue,
                  stateValue,
                  roleValue,
                });
              }
            }
            checked += 1;
          }
        }
      }
    }

    return { checked, failures, minTarget };
  });

  if (layout.failures.length) {
    throw new Error(`Layout validation failed: ${JSON.stringify(layout.failures.slice(0, 20))}`);
  }

  await page.goto(
    `${fileUrl}?screen=create&state=validation&role=warehouse&lang=kk&width=320&long=1&keyboard=1`,
    { waitUntil: "load" },
  );
  await page.locator("#inspection-name").focus();
  const keyboard = await page.evaluate(() => {
    const phone = document.querySelector(".phone");
    const footer = document.querySelector(".phone-footer").getBoundingClientRect();
    const keyboardPreview = document.querySelector(".keyboard-preview").getBoundingClientRect();
    const device = document.querySelector(".device").getBoundingClientRect();
    const body = document.querySelector(".phone-body").getBoundingClientRect();
    const focused = document.activeElement.getBoundingClientRect();

    return {
      isOpen: phone.classList.contains("keyboard-open"),
      footerAboveKeyboard: footer.bottom <= keyboardPreview.top + 1,
      focusedFieldVisible: focused.top >= body.top && focused.bottom <= footer.top,
      insideDevice:
        keyboardPreview.left >= device.left &&
        keyboardPreview.right <= device.right &&
        keyboardPreview.bottom <= device.bottom,
    };
  });

  if (
    !keyboard.isOpen ||
    !keyboard.footerAboveKeyboard ||
    !keyboard.focusedFieldVisible ||
    !keyboard.insideDevice
  ) {
    throw new Error(`Keyboard layout validation failed: ${JSON.stringify(keyboard)}`);
  }
  if ((await page.title()) !== dictionaries.kk["lab.title"]) {
    throw new Error("The document title did not switch to the selected locale.");
  }
  if ((await page.locator(".viewport-options").getAttribute("aria-labelledby")) !== "viewport-label") {
    throw new Error("The viewport selector has no localized accessible name.");
  }

  await page.goto(`${fileUrl}?screen=resolver`, { waitUntil: "load" });
  if ((await page.locator("#state").inputValue()) !== "building") {
    throw new Error("Missing resolver state did not fall back to the first valid state.");
  }

  await page.goto(`${fileUrl}?screen=create&state=bogus`, { waitUntil: "load" });
  if ((await page.locator("#state").inputValue()) !== "default") {
    throw new Error("Invalid create state did not fall back to the first valid state.");
  }

  await page.goto(
    `${fileUrl}?screen=resolver&state=unknown&role=warehouse&lang=ru&width=320`,
    { waitUntil: "load" },
  );
  await page.locator('[data-screen="newItem"]').click();
  if ((await page.locator("#screen").inputValue()) !== "newItem") {
    throw new Error("Unknown QR did not transition to the new-item screen.");
  }

  const allowedNewItemResults = await page
    .locator("#app .result-grid button")
    .allTextContents();
  if (
    allowedNewItemResults.join("|") !==
    ["На месте", "Неисправен", "Не удалось определить"].join("|")
  ) {
    throw new Error(`Unexpected new-item results: ${allowedNewItemResults.join("|")}`);
  }

  await page.locator('[data-number-type="official"]').click();
  if ((await page.locator("#official-number").count()) !== 1) {
    throw new Error("Official inventory-number input is not reachable.");
  }

  await page.goto(
    `${fileUrl}?screen=notifications&state=feed&role=warehouse&lang=ru&width=320`,
    { waitUntil: "load" },
  );
  const technicianFeed = await page.locator("#app").innerText();
  const technicianEvents = [
    "notifications.recheck",
    "notifications.resolvedByAdmin",
    "notifications.adminQueueResolved",
    "notifications.confirmed",
  ];
  for (const key of technicianEvents) {
    if (!technicianFeed.includes(dictionaries.ru[key])) {
      throw new Error(`Technician feed is missing ${key}.`);
    }
  }
  for (const key of ["notifications.transfer", "notifications.decision"]) {
    if (technicianFeed.includes(dictionaries.ru[key])) {
      throw new Error(`Technician feed leaks employee-only ${key}.`);
    }
  }
  if (
    (await page.locator(".notification-list > li").count()) !== technicianEvents.length ||
    (await page.locator(".notification-list > li .notification-link").count()) !==
      technicianEvents.length
  ) {
    throw new Error("Technician notification feed is not a semantic linked list.");
  }

  await page.goto(
    `${fileUrl}?screen=notifications&state=feed&role=employee&lang=ru&width=320`,
    { waitUntil: "load" },
  );
  const employeeFeed = await page.locator("#app").innerText();
  const employeeEvents = [
    "notifications.transfer",
    "notifications.transferConfirmed",
    "notifications.transferRejected",
    "notifications.transferCancelled",
    "notifications.transferOverridden",
    "notifications.decision",
    "notifications.recheckRequested",
    "notifications.closedPresent",
    "notifications.resolvedByAdmin",
  ];
  for (const key of employeeEvents) {
    if (!employeeFeed.includes(dictionaries.ru[key])) {
      throw new Error(`Employee feed is missing ${key}.`);
    }
  }
  if (employeeFeed.includes(dictionaries.ru["notifications.adminQueue"])) {
    throw new Error("Employee feed leaks the administrator queue.");
  }
  if (
    (await page.locator(".notification-list > li").count()) !== employeeEvents.length ||
    (await page.locator(".notification-list > li .notification-link").count()) !==
      employeeEvents.length
  ) {
    throw new Error("Employee notification feed is not a semantic linked list.");
  }

  await page.goto(
    `${fileUrl}?screen=notifications&state=feed&role=admin&lang=ru&width=320`,
    { waitUntil: "load" },
  );
  const adminFeed = await page.locator("#app").innerText();
  if (
    !adminFeed.includes(dictionaries.ru["notifications.adminQueue"]) ||
    adminFeed.includes(dictionaries.ru["notifications.transfer"]) ||
    adminFeed.includes(dictionaries.ru["notifications.confirmed"]) ||
    (await page.locator(".notification-list > li").count()) !== 1 ||
    (await page.locator(".notification-list > li .notification-link").count()) !== 1
  ) {
    throw new Error("Administrator feed does not match the shared-queue event matrix.");
  }

  const sensitiveResolverStates = [
    "building",
    "room",
    "unknown",
    "unissued",
    "ambiguous",
    "revoked",
    "inactive",
    "wrongContext",
  ];
  for (const resolverState of sensitiveResolverStates) {
    await page.goto(
      `${fileUrl}?screen=resolver&state=${resolverState}&role=employee&lang=en&width=320`,
      { waitUntil: "load" },
    );
    const projection = await page.locator("#app").innerText();
    if (!projection.includes(dictionaries.en["resolver.notAccessible"])) {
      throw new Error(`Employee resolver state ${resolverState} is not non-enumerating.`);
    }
    if (
      projection.includes(dictionaries.en[`resolver.${resolverState}`]) &&
      dictionaries.en[`resolver.${resolverState}`] !== dictionaries.en["resolver.notAccessible"]
    ) {
      throw new Error(`Employee resolver state ${resolverState} leaks its exact reason.`);
    }
  }

  await page.goto(
    `${fileUrl}?screen=newItem&state=success&role=warehouse&lang=en&width=320&number=official`,
    { waitUntil: "load" },
  );
  const officialSuccess = await page.locator("#app").innerText();
  if (
    !officialSuccess.includes(dictionaries.en["new.successOfficial"]) ||
    officialSuccess.includes(dictionaries.en["new.successTemporary"])
  ) {
    throw new Error("Official-number success copy is incorrect.");
  }

  await page.goto(
    `${fileUrl}?screen=newItem&state=success&role=warehouse&lang=en&width=320&number=temporary`,
    { waitUntil: "load" },
  );
  const temporarySuccess = await page.locator("#app").innerText();
  if (
    !temporarySuccess.includes(dictionaries.en["new.successTemporary"]) ||
    temporarySuccess.includes(dictionaries.en["new.successOfficial"])
  ) {
    throw new Error("Temporary-number success copy is incorrect.");
  }

  for (const loadingScreen of ["inspections", "notifications"]) {
    await page.goto(
      `${fileUrl}?screen=${loadingScreen}&state=loading&role=warehouse&lang=kk&width=320`,
      { waitUntil: "load" },
    );
    if ((await page.locator('#app [aria-busy="true"]').count()) < 1) {
      throw new Error(`${loadingScreen} loading state has no busy region.`);
    }
    const loadingStatus = page.locator('#app [role="status"]');
    if (
      (await loadingStatus.count()) < 1 ||
      !(await loadingStatus.first().innerText()).includes(dictionaries.kk["common.loading"])
    ) {
      throw new Error(`${loadingScreen} loading state is silent to assistive technology.`);
    }
  }

  const submittingStates = [
    {
      screen: "create",
      state: "submitting",
      role: "warehouse",
      statusKey: "common.saving",
    },
    {
      screen: "newItem",
      state: "submitting",
      role: "warehouse",
      statusKey: "common.saving",
    },
    {
      screen: "scanner",
      state: "resolving",
      role: "warehouse",
      statusKey: "scanner.resolving",
    },
    {
      screen: "scanner",
      state: "pending",
      role: "warehouse",
      statusKey: "scanner.pending",
    },
  ];
  for (const asyncState of submittingStates) {
    await page.goto(
      `${fileUrl}?screen=${asyncState.screen}&state=${asyncState.state}&role=${asyncState.role}&lang=en&width=320`,
      { waitUntil: "load" },
    );
    if ((await page.locator('#app [aria-busy="true"]').count()) < 1) {
      throw new Error(`${asyncState.screen} submitting state has no busy region.`);
    }
    const statusText = await page.locator('#app [role="status"]').first().innerText();
    if (!statusText.includes(dictionaries.en[asyncState.statusKey])) {
      throw new Error(`${asyncState.screen} submitting state has no localized status.`);
    }
  }

  await page.goto(
    `${fileUrl}?screen=notifications&state=adminReason&role=employee&lang=en&width=320`,
    { waitUntil: "load" },
  );
  if (!(await page.locator("#app").innerText()).includes(dictionaries.en["common.noAccess"])) {
    throw new Error("Employee can see the administrator-only resolution state.");
  }

  await page.goto(
    `${fileUrl}?screen=notifications&state=decisions&role=employee&lang=en&width=320`,
    { waitUntil: "load" },
  );
  await page.locator('[data-state="disputeForm"]').click();
  if ((await page.locator("#state").inputValue()) !== "disputeForm") {
    throw new Error("Dispute action does not open the required-comment form.");
  }
  const disputeComment = page.locator("#dispute-comment");
  if (
    (await disputeComment.getAttribute("required")) === null ||
    (await disputeComment.getAttribute("aria-required")) !== "true" ||
    (await disputeComment.getAttribute("aria-invalid")) !== "true" ||
    !(await page.locator("#app").innerText()).includes(
      dictionaries.en["notifications.disputePhoto"],
    ) ||
    !(await page.locator(".phone-footer .button").isDisabled())
  ) {
    throw new Error("Dispute form does not require a comment and expose an optional photo.");
  }

  await page.goto(
    `${fileUrl}?screen=notifications&state=adminReason&role=admin&lang=en&width=320`,
    { waitUntil: "load" },
  );
  const adminDecisionReason = page.locator("#admin-reason");
  if (
    (await adminDecisionReason.getAttribute("required")) === null ||
    (await adminDecisionReason.getAttribute("aria-required")) !== "true" ||
    (await adminDecisionReason.getAttribute("aria-invalid")) !== "true" ||
    !(await page.locator(".phone-footer .button").isDisabled())
  ) {
    throw new Error("Administrator decision reason is not exposed as required and invalid.");
  }

  await page.goto(
    `${fileUrl}?screen=create&state=default&role=admin&lang=en&width=320`,
    { waitUntil: "load" },
  );
  if ((await page.locator("#inspection-technician").count()) !== 1) {
    throw new Error("Administrator inspection creation lacks the required technician field.");
  }

  await page.goto(
    `${fileUrl}?screen=responsibility&state=free&role=admin&lang=en&width=320`,
    { waitUntil: "load" },
  );
  const adminResponsibility = await page.locator("#app").innerText();
  const responsibilityReason = page.locator("#responsibility-admin-reason");
  if (
    adminResponsibility.includes(dictionaries.en["responsibility.accept"]) ||
    adminResponsibility.includes(dictionaries.en["responsibility.request"]) ||
    (await responsibilityReason.count()) !== 1 ||
    (await responsibilityReason.getAttribute("required")) === null ||
    (await responsibilityReason.getAttribute("aria-required")) !== "true" ||
    (await responsibilityReason.getAttribute("aria-invalid")) !== "true" ||
    !(await page.locator(".phone-footer .button").isDisabled())
  ) {
    throw new Error("Administrator responsibility view exposes the normal employee flow.");
  }

  const adminMutationStates = [
    { screen: "context", state: "select", reasonId: "context-admin-reason" },
    { screen: "result", state: "default", reasonId: "result-admin-reason" },
    { screen: "newItem", state: "form", reasonId: "new-item-admin-reason" },
    { screen: "summary", state: "progress", reasonId: "summary-admin-reason" },
  ];
  for (const adminMutation of adminMutationStates) {
    await page.goto(
      `${fileUrl}?screen=${adminMutation.screen}&state=${adminMutation.state}&role=admin&lang=en&width=320`,
      { waitUntil: "load" },
    );
    const reason = page.locator(`#${adminMutation.reasonId}`);
    if (
      (await reason.count()) !== 1 ||
      (await reason.getAttribute("required")) === null ||
      (await reason.getAttribute("aria-required")) !== "true" ||
      (await reason.getAttribute("aria-invalid")) !== "true"
    ) {
      throw new Error(`${adminMutation.screen} administrator mutation lacks a reason field.`);
    }
    if ((await page.locator(".phone-footer .button:disabled").count()) < 1) {
      throw new Error(`${adminMutation.screen} administrator mutation is enabled without a reason.`);
    }
  }

  await page.goto(
    `${fileUrl}?screen=newItem&state=form&role=warehouse&lang=en&width=320&keyboard=1`,
    { waitUntil: "load" },
  );
  if ((await page.locator('#app [aria-pressed="true"]').count()) < 2) {
    throw new Error("Selected result/number controls lack accessible pressed state.");
  }
  if ((await page.locator("#app main").count()) !== 0) {
    throw new Error("The phone mockup nests a second main landmark.");
  }
  await page.locator('[data-number-type="official"]').click();
  if (
    (await page.evaluate(() => document.activeElement?.dataset.numberType)) !== "official"
  ) {
    throw new Error("Number-type selection loses keyboard focus after rerender.");
  }
  await page.locator('[data-result="broken"]').click();
  if ((await page.locator('[data-result="broken"]').getAttribute("aria-pressed")) !== "true") {
    throw new Error("Selecting a result does not update its accessible pressed state.");
  }
  if ((await page.evaluate(() => document.activeElement?.dataset.result)) !== "broken") {
    throw new Error("Result selection loses keyboard focus after rerender.");
  }

  if (browserErrors.length) {
    throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  }

  process.stdout.write(
    `${JSON.stringify({
      languages,
      dictionaryKeys: referenceKeys.length,
      combinations: layout.checked,
      viewport: "320x568",
      minTouchTarget: layout.minTarget,
      keyboard,
      browserErrors: browserErrors.length,
    })}\n`,
  );
} finally {
  await browser.close();
}
