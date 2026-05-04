let state = { projects: [], selectedProjectId: "" };
let selectedProjectId = "";
let hydrated = false;

const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  maximumFractionDigits: 0,
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadState() {
  state = await api("/api/state");
  selectedProjectId = state.selectedProjectId || state.projects[0]?.id || "";
  hydrated = true;
  render();
}

async function persist({ rerender = true } = {}) {
  state.selectedProjectId = selectedProjectId;
  if (rerender) {
    render();
  } else {
    refreshChrome();
  }
  await api("/api/state", {
    method: "POST",
    body: JSON.stringify(state),
  });
}

function selectedProject() {
  const project = state.projects.find((item) => item.id === selectedProjectId) || state.projects[0];
  if (project) {
    normalizeProject(project);
  }
  return project;
}

function normalizeProject(project) {
  ["contractExpiryDates", "penetrationTests", "vulnerabilityAssessments", "riskAssessments"].forEach((key) => {
    if (!Array.isArray(project[key])) {
      project[key] = [];
    }
  });
  if (!project.contractExpiryDates.length && project.contractExpiryDate) {
    project.contractExpiryDates = [project.contractExpiryDate];
  }
  project.contractExpiryDates.forEach((row, index) => {
    if (typeof row === "object" && row !== null) {
      row.date = row.date || "";
      row.description = row.description || "";
    } else {
      project.contractExpiryDates[index] = { date: row || "", description: "" };
    }
  });
  delete project.contractExpiryDate;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function total(projects, key) {
  return projects.reduce((sum, project) => sum + asNumber(project[key]), 0);
}

function utilisation(project, key) {
  return project.monthlyUtilisation.reduce((sum, row) => sum + asNumber(row[key]), 0);
}

function fyTotal(project, key) {
  return project.financialYears.reduce((sum, row) => sum + asNumber(row[key]), 0);
}

function percent(used, budget) {
  if (!budget) return "0% utilised";
  return `${Math.round((used / budget) * 100)}% utilised`;
}

function render() {
  if (!hydrated) return;
  renderProjectList();
  renderForm();
  renderPortfolioMetrics();
  renderCharts();
  renderReconciliation();
}

function refreshChrome() {
  renderProjectList();
  renderPortfolioMetrics();
  renderCharts();
  renderReconciliation();
  const active = selectedProject();
  $("#pageTitle").textContent = active?.projectName || "Untitled project";
  if (active) {
    renderBudgetSummaries(active);
  }
}

function renderProjectList() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const list = $("#projectList");
  const filtered = state.projects.filter((project) =>
    [project.projectName, project.projectManager, project.vendorCompany, project.systemOwner]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );

  list.innerHTML = "";
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">No matching projects</div>`;
    return;
  }

  filtered.forEach((project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-link${project.id === selectedProjectId ? " active" : ""}`;
    button.innerHTML = `<strong>${escapeHtml(project.projectName || "Untitled project")}</strong><span>${escapeHtml(project.projectManager || "No manager assigned")}</span>`;
    button.addEventListener("click", () => {
      selectedProjectId = project.id;
      render();
      persist({ rerender: false });
    });
    list.appendChild(button);
  });
}

function renderPortfolioMetrics() {
  const portfolioDevelopment = total(state.projects, "developmentBudget");
  const portfolioOperating = total(state.projects, "operatingBudget");
  const active = selectedProject();
  const development = active ? asNumber(active.developmentBudget) : 0;
  const operating = active ? asNumber(active.operatingBudget) : 0;
  const securityRows = active
    ? active.penetrationTests.length + active.vulnerabilityAssessments.length + active.riskAssessments.length
    : 0;
  const renewals = active ? active.contractExpiryDates.length : 0;

  $("#projectCount").textContent = state.projects.length;
  $("#totalBudget").textContent = money.format(portfolioDevelopment + portfolioOperating);
  $("#developmentTotal").textContent = money.format(development);
  $("#operatingTotal").textContent = money.format(operating);
  $("#contractSoon").textContent = renewals;
  $("#securityReviewCount").textContent = securityRows;

  const developmentUsed = active ? utilisation(active, "development") : 0;
  const operatingUsed = active ? utilisation(active, "operating") : 0;
  $("#developmentUsed").textContent = active
    ? `${money.format(developmentUsed)} spent - ${percent(developmentUsed, active.developmentBudget)}`
    : "No selected project";
  $("#operatingUsed").textContent = active
    ? `${money.format(operatingUsed)} spent - ${percent(operatingUsed, active.operatingBudget)}`
    : "No selected project";
}

function renderReconciliation() {
  const project = selectedProject();
  if (!project) return;
  updateReconciliation("development", project.developmentBudget, fyTotal(project, "development"), utilisation(project, "development"));
  updateReconciliation("operating", project.operatingBudget, fyTotal(project, "operating"), utilisation(project, "operating"));
}

function updateReconciliation(type, profileTotal, fyBudgetTotal, spentTotal) {
  const variance = profileTotal - fyBudgetTotal;
  const overUnder = profileTotal - spentTotal;
  const card = $(`#${type}Reconcile`).closest(".reconciliation-card");
  const title = $(`#${type}Reconcile`);
  const detail = $(`#${type}ReconcileDetail`);
  const isBalanced = Math.abs(variance) < 0.01;
  card.classList.toggle("is-balanced", isBalanced);
  card.classList.toggle("has-variance", !isBalanced);
  title.textContent = `${money.format(Math.abs(variance))} ${isBalanced ? "variance" : "FY variance"}`;
  detail.textContent = isBalanced
    ? `Profile total equals FY budget. ${money.format(spentTotal)} spent, ${money.format(overUnder)} remaining.`
    : `Profile total is ${money.format(profileTotal)}, FY total is ${money.format(fyBudgetTotal)}, and monthly spent is ${money.format(spentTotal)}.`;
}

function renderCharts() {
  renderPortfolioBudgetChart();
  renderProjectCompositionChart();
  renderFyBudgetChart();
  renderMonthlyUtilisationChart();
}

function renderPortfolioBudgetChart() {
  const chart = $("#portfolioBudgetChart");
  const max = Math.max(...state.projects.map((project) => asNumber(project.developmentBudget) + asNumber(project.operatingBudget)), 1);
  chart.innerHTML = state.projects
    .map((project) => {
      const development = asNumber(project.developmentBudget);
      const operating = asNumber(project.operatingBudget);
      const totalBudget = development + operating;
      const devWidth = totalBudget ? (development / max) * 100 : 0;
      const opWidth = totalBudget ? (operating / max) * 100 : 0;
      return `
        <div class="chart-row">
          <div class="chart-label" title="${escapeHtml(project.projectName)}">${escapeHtml(project.projectName || "Untitled")}</div>
          <div class="stacked-bar" aria-label="${escapeHtml(project.projectName)} budget">
            <span class="development-fill" style="width:${devWidth}%"></span>
            <span class="operating-fill" style="width:${opWidth}%"></span>
          </div>
          <div class="chart-value">${money.format(totalBudget)}</div>
        </div>
      `;
    })
    .join("");
}

function renderProjectCompositionChart() {
  const project = selectedProject();
  const chart = $("#projectCompositionChart");
  if (!project) {
    chart.innerHTML = `<div class="empty-state">No project selected</div>`;
    return;
  }
  const development = asNumber(project.developmentBudget);
  const operating = asNumber(project.operatingBudget);
  const totalBudget = development + operating;
  const developmentAngle = totalBudget ? Math.round((development / totalBudget) * 360) : 0;
  chart.innerHTML = `
    <div class="donut" style="--development-angle: ${developmentAngle}deg" role="img" aria-label="Development and operating budget composition"></div>
    <ul class="legend-list">
      <li><span class="legend-dot development-fill"></span><span>Development</span><strong>${money.format(development)}</strong></li>
      <li><span class="legend-dot operating-fill"></span><span>Operating</span><strong>${money.format(operating)}</strong></li>
      <li><span class="legend-dot spent-fill"></span><span>Total spent</span><strong>${money.format(utilisation(project, "development") + utilisation(project, "operating"))}</strong></li>
    </ul>
  `;
}

function renderFyBudgetChart() {
  const project = selectedProject();
  const chart = $("#fyBudgetChart");
  if (!project || !project.financialYears.length) {
    chart.innerHTML = `<div class="empty-state">No financial year data</div>`;
    return;
  }
  const max = Math.max(...project.financialYears.map((row) => asNumber(row.development) + asNumber(row.operating)), 1);
  chart.innerHTML = project.financialYears
    .map((row) => {
      const development = asNumber(row.development);
      const operating = asNumber(row.operating);
      const totalBudget = development + operating;
      return `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(row.year || "Unassigned FY")}</div>
          <div class="stacked-bar">
            <span class="development-fill" style="width:${(development / max) * 100}%"></span>
            <span class="operating-fill" style="width:${(operating / max) * 100}%"></span>
          </div>
          <div class="chart-value">${money.format(totalBudget)}</div>
        </div>
      `;
    })
    .join("");
}

function renderMonthlyUtilisationChart() {
  const project = selectedProject();
  const chart = $("#monthlyUtilisationChart");
  if (!project || !project.monthlyUtilisation.length) {
    chart.innerHTML = `<div class="empty-state">No monthly utilisation data</div>`;
    return;
  }
  const max = Math.max(...project.monthlyUtilisation.map((row) => asNumber(row.development) + asNumber(row.operating)), 1);
  chart.innerHTML = project.monthlyUtilisation
    .map((row) => {
      const development = asNumber(row.development);
      const operating = asNumber(row.operating);
      const spent = development + operating;
      return `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(row.month || "Unassigned")}</div>
          <div class="stacked-bar">
            <span class="development-fill" style="width:${(development / max) * 100}%"></span>
            <span class="operating-fill" style="width:${(operating / max) * 100}%"></span>
          </div>
          <div class="chart-value">${money.format(spent)}</div>
        </div>
      `;
    })
    .join("");
}

function renderForm() {
  const project = selectedProject();
  if (!project) return;

  $("#pageTitle").textContent = project.projectName || "Untitled project";
  [
    "projectName",
    "projectManager",
    "vendorCompany",
    "systemOwner",
    "description",
    "developmentBudget",
    "operatingBudget",
    "budgetApprovedDate",
    "commissionedDate",
  ].forEach((id) => {
    $(`#${id}`).value = project[id] ?? "";
  });

  renderFyRows(project);
  renderMonthRows(project);
  renderAttachments(project);
  renderContractDates(project);
  renderReviewDates(project, "penetrationTests");
  renderReviewDates(project, "vulnerabilityAssessments");
  renderReviewDates(project, "riskAssessments");
  renderBudgetSummaries(project);
}

function renderBudgetSummaries(project) {
  const fyDevelopment = fyTotal(project, "development");
  const fyOperating = fyTotal(project, "operating");
  const spentDevelopment = utilisation(project, "development");
  const spentOperating = utilisation(project, "operating");
  $("#fySummary").innerHTML = `
    <div><span>Development FY total</span><strong>${money.format(fyDevelopment)}</strong></div>
    <div><span>Operating FY total</span><strong>${money.format(fyOperating)}</strong></div>
    <div><span>Combined FY total</span><strong>${money.format(fyDevelopment + fyOperating)}</strong></div>
  `;
  $("#monthSummary").innerHTML = `
    <div><span>Development spent</span><strong>${money.format(spentDevelopment)}</strong></div>
    <div><span>Operating spent</span><strong>${money.format(spentOperating)}</strong></div>
    <div><span>Total spent</span><strong>${money.format(spentDevelopment + spentOperating)}</strong></div>
  `;
}

function renderFyRows(project) {
  const container = $("#fyRows");
  container.innerHTML = "";
  if (!project.financialYears.length) {
    container.innerHTML = `<div class="empty-state">No financial year rows yet</div>`;
    return;
  }

  project.financialYears.forEach((row, index) => {
    const node = $("#fyRowTemplate").content.cloneNode(true);
    const element = node.querySelector(".fy-row");
    element.querySelector(".fy-year").value = row.year || "";
    element.querySelector(".fy-development").value = row.development || "";
    element.querySelector(".fy-operating").value = row.operating || "";
    element.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        row.year = element.querySelector(".fy-year").value;
        row.development = asNumber(element.querySelector(".fy-development").value);
        row.operating = asNumber(element.querySelector(".fy-operating").value);
        persist({ rerender: false });
      });
    });
    element.querySelector(".remove-row").addEventListener("click", () => {
      project.financialYears.splice(index, 1);
      persist();
    });
    container.appendChild(node);
  });
}

function renderMonthRows(project) {
  const container = $("#monthRows");
  container.innerHTML = "";
  if (!project.monthlyUtilisation.length) {
    container.innerHTML = `<div class="empty-state">No monthly utilisation rows yet</div>`;
    return;
  }

  project.monthlyUtilisation.forEach((row, index) => {
    const node = $("#monthRowTemplate").content.cloneNode(true);
    const element = node.querySelector(".month-row");
    element.querySelector(".util-month").value = row.month || "";
    element.querySelector(".util-development").value = row.development || "";
    element.querySelector(".util-operating").value = row.operating || "";
    element.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        row.month = element.querySelector(".util-month").value;
        row.development = asNumber(element.querySelector(".util-development").value);
        row.operating = asNumber(element.querySelector(".util-operating").value);
        persist({ rerender: false });
      });
    });
    element.querySelector(".remove-row").addEventListener("click", () => {
      project.monthlyUtilisation.splice(index, 1);
      persist();
    });
    container.appendChild(node);
  });
}

function renderAttachments(project) {
  const list = $("#attachmentList");
  list.innerHTML = "";
  if (!project.attachments.length) {
    list.innerHTML = `<li class="empty-attachment"><div><strong>No documents attached</strong><small>Upload related project files</small></div></li>`;
    return;
  }

  project.attachments.forEach((file, index) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatBytes(file.size)} - ${escapeHtml(file.type || "Unknown type")}</small>
      </div>
      <a class="icon-button attachment-link" href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer" title="Open attachment">Open</a>
      <button class="icon-button remove-attachment" type="button" title="Remove attachment">x</button>
    `;
    item.querySelector(".remove-attachment").addEventListener("click", () => {
      project.attachments.splice(index, 1);
      persist();
    });
    list.appendChild(item);
  });
}

function renderReviewDates(project, key) {
  const list = $(`#${key}`);
  list.innerHTML = "";
  if (!project[key].length) {
    list.innerHTML = `<li><div class="empty-copy">No dates recorded</div></li>`;
    return;
  }

  project[key].forEach((date, index) => {
    const node = $("#dateRowTemplate").content.cloneNode(true);
    const input = node.querySelector("input");
    input.value = date || "";
    input.addEventListener("input", () => {
      project[key][index] = input.value;
      persist({ rerender: false });
    });
    node.querySelector(".remove-date").addEventListener("click", () => {
      project[key].splice(index, 1);
      persist();
    });
    list.appendChild(node);
  });
}

function renderContractDates(project) {
  const list = $("#contractExpiryDates");
  list.innerHTML = "";
  if (!project.contractExpiryDates.length) {
    list.innerHTML = `<li><div class="empty-copy">No contract rows added</div></li>`;
    return;
  }

  project.contractExpiryDates.forEach((row, index) => {
    const node = $("#contractRowTemplate").content.cloneNode(true);
    const dateInput = node.querySelector(".contract-date");
    const descriptionInput = node.querySelector(".contract-description");
    dateInput.value = row.date || "";
    descriptionInput.value = row.description || "";
    [dateInput, descriptionInput].forEach((input) => {
      input.addEventListener("input", () => {
        project.contractExpiryDates[index] = {
          date: dateInput.value,
          description: descriptionInput.value,
        };
        persist({ rerender: false });
      });
    });
    node.querySelector(".remove-contract").addEventListener("click", () => {
      project.contractExpiryDates.splice(index, 1);
      persist();
    });
    list.appendChild(node);
  });
}

function syncContractRowsFromDom(project) {
  document.querySelectorAll("#contractExpiryDates li").forEach((item, index) => {
    const dateInput = item.querySelector(".contract-date");
    const descriptionInput = item.querySelector(".contract-description");
    if (!dateInput || !descriptionInput) return;
    project.contractExpiryDates[index] = {
      date: dateInput.value,
      description: descriptionInput.value,
    };
  });
}

function bindForm() {
  $("#projectForm").addEventListener("input", (event) => {
    const project = selectedProject();
    if (!project || !event.target.id) return;
    const numeric = ["developmentBudget", "operatingBudget"];
    project[event.target.id] = numeric.includes(event.target.id) ? asNumber(event.target.value) : event.target.value;
    persist({ rerender: false });
  });

  $("#newProjectBtn").addEventListener("click", async () => {
    state = await api("/api/projects", { method: "POST" });
    selectedProjectId = state.selectedProjectId;
    render();
  });

  $("#deleteProjectBtn").addEventListener("click", async () => {
    if (state.projects.length === 1) return;
    state = await api(`/api/projects/${selectedProjectId}`, { method: "DELETE" });
    selectedProjectId = state.selectedProjectId;
    render();
  });

  $("#addFyBtn").addEventListener("click", () => {
    const project = selectedProject();
    project.financialYears.push({ year: "", development: 0, operating: 0 });
    persist();
  });

  $("#addMonthBtn").addEventListener("click", () => {
    const project = selectedProject();
    project.monthlyUtilisation.push({ month: "", development: 0, operating: 0 });
    persist();
  });

  document.querySelectorAll(".add-review").forEach((button) => {
    button.addEventListener("click", () => {
      const project = selectedProject();
      if (button.dataset.review === "contractExpiryDates") {
        syncContractRowsFromDom(project);
        project.contractExpiryDates.push({ date: "", description: "" });
      } else {
        project[button.dataset.review].push("");
      }
      persist();
    });
  });

  $("#fileInput").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    const response = await fetch(`/api/projects/${selectedProjectId}/attachments`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      alert("Upload failed.");
      return;
    }
    state = await response.json();
    event.target.value = "";
    render();
  });

  $("#searchInput").addEventListener("input", renderProjectList);
  $("#exportBtn").addEventListener("click", exportJson);
  $("#importInput").addEventListener("change", importJson);
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "project-portfolio-dashboard.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.projects)) throw new Error("Missing projects array");
      state = parsed;
      selectedProjectId = parsed.selectedProjectId || parsed.projects[0]?.id;
      await persist();
    } catch {
      alert("This file is not a valid dashboard export.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

bindForm();
loadState().catch(() => {
  document.body.innerHTML = `<main class="load-error"><h1>Dashboard server is not running</h1><p>Start it with <code>python app.py</code>, then open <code>http://127.0.0.1:8000</code>.</p></main>`;
});
