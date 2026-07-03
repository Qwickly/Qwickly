import type { ClientType } from "@/types/catalog";

function toCsvValue(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function rowsToCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const lines = [headers.map(toCsvValue).join(","), ...rows.map((row) => row.map(toCsvValue).join(","))];
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export type ParsedClientCsvRow = {
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  clientType?: ClientType;
  rowIndex: number;
  totalScore?: string;
  reviewsCount?: string;
  street?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  website?: string;
  url?: string;
  categoryName?: string;
  categories?: string[];
};

const southAfricanInternationalPhoneRegex = /\+27\d{9}\b/g;
const exactSouthAfricanInternationalPhoneRegex = /^\+27\d{9}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const delimiterPriority = [",", ";", "\t", "|"] as const;

const normalizeHeader = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();

const headerMatches = (header: string, patterns: readonly string[]) =>
  patterns.some((pattern) => header === pattern);

const fieldCandidates = {
  name: ["name", "full name", "fullname", "customer name", "customer", "display name", "title"],
  firstName: ["first name", "firstname", "given name", "givenname"],
  lastName: ["last name", "lastname", "surname", "family name", "familyname"],
  phone: ["phone", "phone number", "phone1", "phone 1", "mobile", "mobile phone", "contact phone", "contact"],
  email: ["email", "email address", "emailaddress", "contact email", "contactemail"],
  notes: ["note", "notes", "tags", "customer tags", "remarks"],
  clientType: ["client type", "type", "customer type", "status"],
  totalScore: ["total score", "score", "rating"],
  reviewsCount: ["reviews count", "reviews", "review count"],
  street: ["street", "address", "street address"],
  city: ["city"],
  state: ["state", "province"],
  countryCode: ["country code", "country"],
  website: ["website", "web", "site"],
  url: ["url", "link"],
  categoryName: ["category name", "category"],
} as const;

const parseCsvLine = (line: string, delimiter: string) => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
};

const detectDelimiter = (headerLine: string) => {
  if (headerLine.includes("\t")) return "\t";
  const counts = delimiterPriority.map((delimiter) => ({
    delimiter,
    count: headerLine.split(delimiter).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].delimiter;
};

const findFieldKey = (header: string) => {
  const normalized = normalizeHeader(header);
  if (headerMatches(normalized, fieldCandidates.name)) return "name" as const;
  if (headerMatches(normalized, fieldCandidates.firstName)) return "firstName" as const;
  if (headerMatches(normalized, fieldCandidates.lastName)) return "lastName" as const;
  if (headerMatches(normalized, fieldCandidates.phone)) return "phone" as const;
  if (headerMatches(normalized, fieldCandidates.email)) return "email" as const;
  if (headerMatches(normalized, fieldCandidates.notes)) return "notes" as const;
  if (headerMatches(normalized, fieldCandidates.clientType)) return "clientType" as const;
  if (headerMatches(normalized, fieldCandidates.totalScore)) return "totalScore" as const;
  if (headerMatches(normalized, fieldCandidates.reviewsCount)) return "reviewsCount" as const;
  if (headerMatches(normalized, fieldCandidates.street)) return "street" as const;
  if (headerMatches(normalized, fieldCandidates.city)) return "city" as const;
  if (headerMatches(normalized, fieldCandidates.state)) return "state" as const;
  if (headerMatches(normalized, fieldCandidates.countryCode)) return "countryCode" as const;
  if (headerMatches(normalized, fieldCandidates.website)) return "website" as const;
  if (headerMatches(normalized, fieldCandidates.url)) return "url" as const;
  if (headerMatches(normalized, fieldCandidates.categoryName)) return "categoryName" as const;
  return null;
};

const normalizeClientType = (value: string): ClientType | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "vip" || normalized === "v.i.p") return "vip";
  if (normalized === "returning" || normalized === "return" || normalized === "existing") return "returning";
  if (normalized === "new" || normalized === "prospect" || normalized === "lead") return "new";
  return undefined;
};

export function parseClientCsvText(text: string): {
  clients: ParsedClientCsvRow[];
  errors: string[];
  warnings: string[];
} {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors: string[] = [];
  const warnings: string[] = [];
  const clients: ParsedClientCsvRow[] = [];

  const headerLine = lines.find((line) => line.trim().length > 0);
  if (!headerLine) {
    return { clients, errors: ["CSV file is empty or does not contain a header row."], warnings };
  }

  const delimiter = detectDelimiter(headerLine);
  const headers = parseCsvLine(headerLine, delimiter);
  const rowKeys = headers.map((header) => normalizeHeader(header));
  const fieldPositions = headers.map((header) => findFieldKey(header));

  const hasName = fieldPositions.includes("name") || fieldPositions.includes("firstName") || fieldPositions.includes("lastName");
  const hasPhone = fieldPositions.includes("phone");
  if (!hasName) {
    warnings.push("Could not find a name column. Rows will only import if a name can be inferred from email.");
  }
  if (!hasPhone) {
    warnings.push("Could not find a phone column. Rows without phone values will be skipped.");
  }

  for (let i = 1; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;

    const cells = parseCsvLine(rawLine, delimiter);
    if (cells.length === 1 && cells[0] === "") continue;

    const getValue = (fieldName: keyof typeof fieldCandidates) => {
      const index = fieldPositions.indexOf(fieldName as any);
      return index >= 0 ? cells[index]?.trim() ?? "" : "";
    };

    // Extract categories from categories/0, categories/1, etc.
    const categories: string[] = [];
    for (let catIndex = 0; catIndex < 10; catIndex++) {
      const catHeader = `categories/${catIndex}`;
      const catIndexPos = headers.findIndex(h => h.trim().toLowerCase() === catHeader.toLowerCase());
      if (catIndexPos >= 0 && cells[catIndexPos]?.trim()) {
        categories.push(cells[catIndexPos].trim());
      }
    }

    const explicitName = getValue("name");
    const firstName = getValue("firstName");
    const lastName = getValue("lastName");
    const email = getValue("email");
    const phone = getValue("phone");
    const notes = getValue("notes");
    const clientTypeRaw = getValue("clientType");
    const totalScore = getValue("totalScore");
    const reviewsCount = getValue("reviewsCount");
    const street = getValue("street");
    const city = getValue("city");
    const state = getValue("state");
    const countryCode = getValue("countryCode");
    const website = getValue("website");
    const url = getValue("url");
    const categoryName = getValue("categoryName");

    const inferredName = explicitName || `${firstName} ${lastName}`.trim() || email || "";

    if (!inferredName) {
      errors.push(`Row ${i + 1}: missing name and no valid fallback value.`);
      continue;
    }

    if (!phone.trim()) {
      errors.push(`Row ${i + 1}: missing phone number. A phone is required to import clients.`);
      continue;
    }

    // Build notes from additional fields
    const additionalNotes: string[] = [];
    if (street) additionalNotes.push(`Address: ${street}`);
    if (city) additionalNotes.push(city);
    if (state) additionalNotes.push(state);
    if (countryCode) additionalNotes.push(countryCode);
    if (website) additionalNotes.push(`Website: ${website}`);
    if (totalScore) additionalNotes.push(`Rating: ${totalScore}`);
    if (reviewsCount) additionalNotes.push(`${reviewsCount} reviews`);
    if (categoryName || categories.length > 0) {
      const allCategories = [...new Set([categoryName, ...categories].filter(Boolean))];
      if (allCategories.length > 0) additionalNotes.push(`Categories: ${allCategories.join(", ")}`);
    }
    if (url) additionalNotes.push(`URL: ${url}`);

    const combinedNotes = [notes, ...additionalNotes].filter(Boolean).join(" | ");

    clients.push({
      rowIndex: i + 1,
      name: inferredName,
      phone: phone.trim(),
      email: email.trim() || null,
      notes: combinedNotes || null,
      clientType: normalizeClientType(clientTypeRaw) ?? "new",
      totalScore: totalScore || undefined,
      reviewsCount: reviewsCount || undefined,
      street: street || undefined,
      city: city || undefined,
      state: state || undefined,
      countryCode: countryCode || undefined,
      website: website || undefined,
      url: url || undefined,
      categoryName: categoryName || undefined,
      categories: categories.length > 0 ? categories : undefined,
    });
  }

  if (clients.length === 0 && errors.length === 0) {
    errors.push("No valid client rows were found in the uploaded file.");
  }

  return { clients, errors, warnings };
}

export function parseClientPdfText(text: string): {
  clients: ParsedClientCsvRow[];
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clients: ParsedClientCsvRow[] = [];
  const seenPhones = new Set<string>();
  let duplicateCount = 0;
  let noNameCount = 0;

  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const customerRecordRegex =
    /"(?<row>\d+)"\s*,\s*"(?<name>[^"]*)"\s*,\s*"(?<phone>\+27\d{9})"\s*,\s*"(?<email>[^"]*)"/g;

  const addClient = (rowIndex: number, name: string, phone: string, email?: string | null) => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email?.trim() ?? "";

    if (!exactSouthAfricanInternationalPhoneRegex.test(trimmedPhone)) return;

    if (!trimmedName || trimmedName.toLowerCase() === "no name") {
      noNameCount += 1;
      return;
    }

    if (seenPhones.has(trimmedPhone)) {
      duplicateCount += 1;
      return;
    }

    seenPhones.add(trimmedPhone);
    clients.push({
      rowIndex,
      name: trimmedName,
      phone: trimmedPhone,
      email: emailRegex.test(trimmedEmail) ? trimmedEmail : null,
      notes: "Imported from PDF customer export",
      clientType: "new",
    });
  };

  for (const match of normalizedText.matchAll(customerRecordRegex)) {
    addClient(
      Number(match.groups?.row ?? clients.length + 1),
      match.groups?.name ?? "",
      match.groups?.phone ?? "",
      match.groups?.email ?? "",
    );
  }

  const tokens = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!exactSouthAfricanInternationalPhoneRegex.test(token)) continue;

    const name = tokens[index - 1] ?? "";
    const email = tokens[index + 1] ?? "";
    const possibleRowIndex = Number(tokens[index - 2]);
    addClient(Number.isFinite(possibleRowIndex) ? possibleRowIndex : clients.length + 1, name, token, email);
  }

  if (clients.length === 0) {
    const uniqueNumbers = Array.from(new Set(normalizedText.match(southAfricanInternationalPhoneRegex) ?? []));
    if (uniqueNumbers.length > 0) {
      errors.push(
        `Found ${uniqueNumbers.length} valid South African phone number${uniqueNumbers.length === 1 ? "" : "s"}, but no complete customer rows with names.`,
      );
    } else {
      errors.push("No +27 South African phone numbers were found in this PDF.");
    }
  }

  if (duplicateCount > 0) {
    warnings.push(`${duplicateCount} duplicate phone number${duplicateCount === 1 ? "" : "s"} skipped.`);
  }

  if (noNameCount > 0) {
    warnings.push(`${noNameCount} row${noNameCount === 1 ? "" : "s"} skipped because the name was "No name".`);
  }

  return { clients, errors, warnings };
}
