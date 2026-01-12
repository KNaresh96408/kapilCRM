import React, { useEffect, useState, useMemo } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";
import { useDashboardFilters } from "../../context/DashboardFilterContext";


import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getScopedQuery } from "../../helpers/getScopedQuery";

export default function OperationsDashboard() {
  const { filters, setFilters } = useDashboardFilters();
  const user = JSON.parse(localStorage.getItem("kp-user") || "{}");

  const [projects, setProjects] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState("DESC");

  // Custom date
  const [showDate, setShowDate] = useState(false);
  const [tempStart, setTempStart] = useState("");
  const [tempEnd, setTempEnd] = useState("");

  const months = [
    "All","January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  const zones = ["All","Hyd","Vijayawada","Vizag","Warangal","Kadapa"];

  // ---------- LOAD PROJECTS ----------
  useEffect(() => {
    const fetchProjects = async () => {
      const q = await getScopedQuery("projects");
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setProjects(data);
    };
    fetchProjects();
  }, []);

  const daysBetween = (a,b) => {
    if (!a || !b) return 0;
    const da = a?.toDate ? a.toDate() : new Date(a);
    const db = b?.toDate ? b.toDate() : new Date(b);
    return Math.max(0, Math.ceil((db - da) / (1000*60*60*24)));
  };

  const monthIndex = (monthName) => {
    if (!monthName || monthName === "All") return null;
    return months.indexOf(monthName);
  };

  // ---------- FILTER ----------
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {

      let d =
        p.dispatchDate ||
        p.installationDate ||
        p.netMeterDate ||
        p.createdAt;

      if (!d) return false;

      d = d?.toDate ? d.toDate() : new Date(d);

      // ZONE
      if (filters.zone && filters.zone !== "All") {
        if ((p.sales_zone || "") !== filters.zone) return false;
      }

      // YEAR
      if (filters.year && filters.year !== "All") {
        if (d.getFullYear() !== Number(filters.year)) return false;
      }

      // MONTH
      if (filters.month && filters.month !== "All") {
        const idx = monthIndex(filters.month);
        if (idx && d.getMonth()+1 !== idx) return false;
      }

      // CUSTOM DATE
      if (filters.startDate && filters.endDate) {
        const s = new Date(filters.startDate);
        const e = new Date(filters.endDate);
        if (d < s || d > e) return false;
      }

      return true;
    });
  }, [projects, filters]);

  // ---------- NORMALIZE ----------
  const mapped = filteredProjects.map(p => {
    return {
      dispatchStatus: p.dispatchDate ? "DONE" : "NOT DONE",
      installationStatus: p.installationDate ? "DONE" : "NOT DONE",
      netMeterStatus: p.netMeterDate ? "DONE" : "NOT DONE",

      dispatchDelay: p.dispatchDate ? daysBetween(p.createdAt, p.dispatchDate) : 0,
      installationDelay: p.installationDate ? daysBetween(p.dispatchDate, p.installationDate) : 0,
      netMeterDelay: p.netMeterDate ? daysBetween(p.installationDate, p.netMeterDate) : 0
    };
  });

  // ---------- STATUS BASED FILTER (PER SECTION) ----------
  const filterByStatus = (list, key) => {
    if (statusFilter === "All") return list;
    return list.filter(p => p[key] === statusFilter);
  };

  const dispatchList = filterByStatus(mapped, "dispatchStatus");
  const installationList = filterByStatus(mapped, "installationStatus");
  const netList = filterByStatus(mapped, "netMeterStatus");

  // ---------- KPI ----------
  const avg = arr =>
    arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(2) : 0;

  const dispatchTAT = avg(dispatchList.map(p=>p.dispatchDelay));
  const installationTAT = avg(installationList.map(p=>p.installationDelay));
  const netTAT = avg(netList.map(p=>p.netMeterDelay));

// ---------- COUNTS ----------
const countChart = (list, key) => {
  let data = [];

  // DONE ONLY
  if (statusFilter === "DONE") {
    data = [
      { name: "Done", value: list.filter(p => p[key] === "DONE").length }
    ];
  }

  // NOT DONE ONLY
  else if (statusFilter === "NOT DONE") {
    data = [
      { name: "Not Done", value: list.filter(p => p[key] !== "DONE").length }
    ];
  }

  // ALL
  else {
    data = [
      { name: "Done", value: list.filter(p => p[key] === "DONE").length },
      { name: "Not Done", value: list.filter(p => p[key] !== "DONE").length },
    ];
  }

  // 🔥 APPLY SORT ORDER TO COUNT CHART ALSO
  if (sortOrder === "ASC") {
    data.sort((a, b) => a.value - b.value);
  } else {
    data.sort((a, b) => b.value - a.value);
  }

  return data;
};


const dispatchCount = countChart(dispatchList, "dispatchStatus");
const installationCount = countChart(installationList, "installationStatus");
const netCount = countChart(netList, "netMeterStatus");


  // ---------- BUCKETS ----------
  const bucketize = (list,key) => {
    const b = {"0-4":0,"5-9":0,"10-14":0,"15-19":0,"20+":0};

    list.forEach(p=>{
      const v = Number(p[key])||0;
      if(v<=4) b["0-4"]++;
      else if(v<=9) b["5-9"]++;
      else if(v<=14) b["10-14"]++;
      else if(v<=19) b["15-19"]++;
      else b["20+"]++;
    });

    let arr = Object.keys(b).map(k=>({name:k,value:b[k]}));

    if(sortOrder==="ASC") arr.sort((a,b)=>a.value-b.value);
    else arr.sort((a,b)=>b.value-a.value);

    return arr;
  };

  const dispatchBuckets = bucketize(dispatchList,"dispatchDelay");
  const installationBuckets = bucketize(installationList,"installationDelay");
  const netBuckets = bucketize(netList,"netMeterDelay");

  const applyDates = () => {
    if(!tempStart || !tempEnd) return;
    setFilters(prev=>({...prev,startDate:new Date(tempStart),endDate:new Date(tempEnd)}));
    setShowDate(false);
  };

  return (
    <div style={{ paddingBottom:40 }}>

      {/* ---------- FILTERS UI ---------- */}
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>

        <select value={filters.zone} onChange={e=>setFilters(prev=>({...prev,zone:e.target.value}))}>
          {zones.map(z=><option key={z}>{z}</option>)}
        </select>

        <select value={filters.year} onChange={e=>setFilters(prev=>({...prev,year:e.target.value}))}>
          <option>All</option>
          <option>2024</option>
          <option>2025</option>
          <option>2026</option>
        </select>

        <select value={filters.month} onChange={e=>setFilters(prev=>({...prev,month:e.target.value}))}>
          {months.map(m=> <option key={m}>{m}</option>)}
        </select>

        <button onClick={()=>setShowDate(!showDate)}>Custom Date</button>

        {showDate && (
          <>
            <input type="date" onChange={e=>setTempStart(e.target.value)} />
            <input type="date" onChange={e=>setTempEnd(e.target.value)} />
            <button onClick={applyDates}>Apply</button>
          </>
        )}

        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option>All</option>
          <option>DONE</option>
          <option>NOT DONE</option>
        </select>

        <select value={sortOrder} onChange={e=>setSortOrder(e.target.value)}>
          <option value="DESC">DESC</option>
          <option value="ASC">ASC</option>
        </select>
      </div>

      {/* KPI */}
      <div style={{ display:"flex", gap:80, marginTop:20 }}>
        <Card title="Dispatch TAT" value={dispatchTAT} color="purple" />
        <Card title="Installation TAT" value={installationTAT} color="orange" />
        <Card title="Net Meter TAT" value={netTAT} color="green" />
      </div>

      <Section title="Dispatch" count={dispatchCount} bucket={dispatchBuckets}/>
      <Section title="Installation" count={installationCount} bucket={installationBuckets}/>
      <Section title="Net Meter" count={netCount} bucket={netBuckets}/>
    </div>
  );
}

const Card = ({title,value,color}) => (
  <div>
    <h4>{title}</h4>
    <h2 style={{color}}>{value} days</h2>
  </div>
);

const Section = ({title,count,bucket}) => (
  <>
    <h3 style={{marginTop:40}}>{title}</h3>
    <div style={{display:"flex",gap:40}}>
      <Chart data={count}/>
      <Chart data={bucket}/>
    </div>
  </>
);

function Chart({data}) {
  return (
    <div style={{width:"48%",height:300}}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3"/>
          <XAxis dataKey="name"/>
          <YAxis allowDecimals={false}/>
          <Tooltip/>
          <Legend/>
          <Bar dataKey="value" fill="#8A2BE2"/>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
