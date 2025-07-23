import minimist from "minimist";
import _ from "lodash";
import axios from "axios";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { sampleHealthcareLeads } from "./healthCareData.ts";
import { appConfig } from "./appConfig.ts";

const config = appConfig();

const args = _.get(minimist(process.argv.slice(2)), "_");
const companyDomain = args[0] || "Hospital";
const companySize = args[1] || "100,500";
const companyLocation = args[2] || "India";
const leadsPageCount = 1;
const leadsPerPage = 5;
const apolloApiKey = process.env.APOLLO_API_KEY;
const scrapTimeout = 10000;

const aboutMe = fs.readFileSync("about.md", "utf-8");

console.log("🔍 Search Criteria:");
console.log(`Industry: ${companyDomain}`);
console.log(`Employee Size: ${companySize}`);
console.log(`Location: ${companyLocation}`);

export interface CompanyLeads {
  name: string;
  website_url: string;
  phone: string;
  primary_domain: string;
  websiteData?: string;
  outreachMessage?: string;
}

const fetchCompanies = async (): Promise<CompanyLeads[]> => {
  const url = `https://api.apollo.io/api/v1/mixed_companies/search?organization_num_employees_ranges[]=${companySize}&organization_locations[]=${companyLocation}&organization_not_locations[]=&currently_using_any_of_technology_uids[]=&q_organization_keyword_tags[]=${companyDomain}&organization_ids[]=&page=${leadsPageCount}&per_page=${leadsPerPage}`;

  const res = await axios.post(url, {
    headers: {
      accept: "application/json",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      "x-api-key": apolloApiKey,
    },
  });

  return _.map(res.data.organizations, (company) => ({
    name: company.name,
    website_url: company.website_url,
    phone: company.phone,
    primary_domain: company.primary_domain,
  }));
};

const scrapWebsiteData = async (company: CompanyLeads): Promise<string> => {
  console.log(`🌐 Scraping insights from - ${company.name}`);
  try {
    const res = await axios.get(company.website_url, { timeout: scrapTimeout });
    const $ = cheerio.load(res.data);
    const textContent = $("body").text();
    return _.chain(textContent)
      .split(".")
      .map((s) => _.trim(s))
      .filter((s) => s.length > 50)
      .take(3)
      .value()
      .join("\n");
  } catch {
    console.warn(`⚠️ Could not scrape ${company.website_url}`);
    return "";
  }
};

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

const gemini = new GoogleGenAI({
  apiKey: config.GEMINI_API_KEY,
});

const openAIPrompt = (webSiteData: string) => {
  return `
        You are a helpful B2B sales assistant. Write a cold outreach email to the following company.

        Your company's description:
        ${aboutMe}

        Target company details:
        ${webSiteData}

        Make the email:
        - Personalized
        - Short and clear
        - Professional
        - Include a CTA to book a quick call or reply
        - Use my contact details in the email

        Output just the email content.
        `;
};

async function generateOutreachMessage(company: CompanyLeads): Promise<string> {
  try {
    console.log("🔄 Generating email for company:", company.name);
    const prompt = openAIPrompt(_.get(company, "websiteData"));
    const response = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "";
  } catch (err) {
    console.error("❌ Error generating email for company:", company.name, err);
    return "";
  }
}

function saveToCSV(data: CompanyLeads[]) {
  const records = _.map(data, (c) => ({
    name: c.name,
    website_url: c.website_url,
    phone: c.phone,
    primary_domain: c.primary_domain,
  }));
  const header = Object.keys(records[0]).join(",");
  const rows = records.map((r) => Object.values(r).join(","));
  fs.writeFileSync("leads.csv", [header, ...rows].join("\n"));
}

function saveEmailsToTxt(companies: CompanyLeads[]) {
  const emailDir = "./emails";

  if (!fs.existsSync(emailDir)) {
    fs.mkdirSync(emailDir);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  _.forEach(companies, (company) => {
    const safeName = company.name.replace(/[^\w\s]/g, "").replace(/\s+/g, "_");
    const filename = `${emailDir}/${safeName}-${timestamp}.txt`;
    const content = _.trim(company.outreachMessage);
    fs.appendFileSync(filename, content);
    console.log(`📩 Email saved for "${company.name}" → ${filename}`);
  });
}

async function main() {
  const companies = await fetchCompanies();
  console.log("🔄 Fetching companies details...");
  const companiesWithScrapedData = await Promise.all(
    _.map(companies, async (company) => ({
      ...company,
      websiteData: await scrapWebsiteData(company),
    }))
  );
  console.log("✅ Companies details fetched...");
  console.log("🔄 Generating outreach messages...");
  const companiesWithOutreachMessage = await Promise.all(
    _.map(companiesWithScrapedData, async (company) => ({
      ...company,
      outreachMessage: await generateOutreachMessage(company),
    }))
  );
  console.log("✅ Messages Generated...");
  console.log("🔄 Saving Emails...");
  saveEmailsToTxt(companiesWithOutreachMessage);
  console.log("✅ Emails Saved...");
  console.log("🔄 Saving CSV...");
  saveToCSV(companiesWithOutreachMessage);
  console.log("✅ CSV Saved...");
}
main();
