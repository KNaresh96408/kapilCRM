// ✅ src/components/quotationTemplates.js
import { db } from "../firebaseConfig";
import { collection, doc, setDoc } from "firebase/firestore";

const templates = [
  {
    templateId: "TEMPLATE-RESIDENTIAL",
    templateName: "Residential-OnGrid",
    type: "Residential",
    panel: {
      wattPeakOptions: [530, 545, 550, 580],
      typeOptions: ["Topcon", "Monofacial", "Bifacial", "Poly"],
      brandOptions: ["Premier_Solar", "Renew_Power", "Adani_Solar", "Tata"],
      default: { wattPeak: 545, type: "Topcon", brand: "Premier_Solar" },
    },
    inverter: {
      sizeOptions: ["3kW", "5kW", "10kW"],
      brandOptions: ["Powerone", "Polycab", "Fronius"],
      default: { size: "10kW", brand: "Polycab" },
    },
    structure: {
      descriptionOptions: [
        "Pre-Galvanized / GI Hot DIP / Similar",
        "Hot-DIP Galvanized",
      ],
      cableBrandOptions: ["Polycab", "Havells", "KEI"],
      default: { description: "Pre-Galvanized / GI Hot DIP / Similar", cableBrand: "Polycab" },
    },
    warranty: { panelPerformance: 30, panel: 12, system: 5, inverter: 8 },
    pricing: { gst: 8.9, subsidy: 0 },
    terms:
      "Prices valid for 30 days from the date of offer. Civil and digging at customer scope.",
    paymentSchedule: [
      "70% advance with Purchase Order",
      "20% against proof of dispatch",
      "10% after installation and commissioning",
    ],
    paymentDetails: {
      company: "Kapil Power and Infra Pvt Ltd",
      bank: "Union Bank Of India",
      branch: "Nanakramguda",
      ifsc: "UBIN0818399",
      accountNo: "183911100000539",
    },
  },
  {
    templateId: "TEMPLATE-COMMERCIAL",
    templateName: "Commercial-General",
    type: "Commercial",
    panel: {
      wattPeakOptions: [530, 545, 550, 580],
      typeOptions: ["Mono PERC", "Topcon", "Bifacial"],
      brandOptions: ["Adani_Solar", "Renew_Power", "Premier_Solar"],
      default: { wattPeak: 545, type: "Mono PERC", brand: "Adani_Solar" },
    },
    inverter: {
      sizeOptions: ["10kW", "20kW", "30kW"],
      brandOptions: ["Fronius", "Polycab", "Huawei"],
      default: { size: "20kW", brand: "Fronius" },
    },
    structure: {
      descriptionOptions: ["Hot-DIP Galvanized", "Aluminum Structure"],
      cableBrandOptions: ["Polycab", "Havells", "KEI"],
      default: { description: "Hot-DIP Galvanized", cableBrand: "Polycab" },
    },
    warranty: { panelPerformance: 25, panel: 10, system: 5, inverter: 8 },
    pricing: { gst: 18, subsidy: 0 },
    terms:
      "Commercial quotation valid for 15 days. Freight and unloading extra.",
    paymentSchedule: [
      "50% advance with PO",
      "40% against material dispatch",
      "10% post installation",
    ],
    paymentDetails: {
      company: "Kapil Power and Infra Pvt Ltd",
      bank: "Union Bank Of India",
      branch: "Nanakramguda",
      ifsc: "UBIN0818399",
      accountNo: "183911100000539",
    },
  },
];

// Run once to push templates to Firestore
export const uploadQuotationTemplates = async () => {
  const colRef = collection(db, "quotationTemplates");
  for (const t of templates) {
    await setDoc(doc(colRef, t.templateId), t);
    console.log(`✅ Uploaded template: ${t.templateName}`);
  }
  console.log("✨ All templates uploaded successfully");
};
