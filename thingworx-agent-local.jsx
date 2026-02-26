import { useState, useRef, useEffect } from "react";

// ══════════════════════════════════════════════════════════════════════════════
//  THINGWORX AI AGENT v2
//  • 100% local / free — no API calls
//  • Generates proper Extension ZIP (Entities/ + metadata/ structure)
//  • Built-in Q&A chatbot for project questions
// ══════════════════════════════════════════════════════════════════════════════

// ─── JSZip CDN loader ────────────────────────────────────────────────────────
let _jszip = null;
async function getJSZip() {
  if (_jszip) return _jszip;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => { _jszip = window.JSZip; resolve(window.JSZip); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function toCamel(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase());
}
function toProjectName(str) {
  return str.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(".");
}
function uid() { return Math.random().toString(36).substr(2, 8); }

// ─── Folder names per entity type ────────────────────────────────────────────
const ENTITY_FOLDER = {
  Project:       "Projects",
  DataShape:     "DataShapes",
  ValueStream:   "Things",       // ValueStream is a Thing
  ThingTemplate: "ThingTemplates",
  Thing:         "Things",
  Mashup:        "Mashups",
  Scheduler:     "Things",       // Scheduler is a Thing
};

// ══════════════════════════════════════════════════════════════════════════════
//  DOMAIN DATA
// ══════════════════════════════════════════════════════════════════════════════
function parseUseCase(text) {
  const t = text.toLowerCase();
  let domain = "generic";
  if (t.includes("temperat") || t.includes("thermometer") || t.includes("heat") || t.includes("hvac")) domain = "temperature";
  else if (t.includes("cnc") || t.includes("machine") || t.includes("manufact") || t.includes("production") || t.includes("milling") || t.includes("lathe")) domain = "cnc";
  else if (t.includes("water") || t.includes("ph") || t.includes("turbid") || t.includes("quality")) domain = "water";
  else if (t.includes("energy") || t.includes("power") || t.includes("electric") || t.includes("kwh") || t.includes("voltage")) domain = "energy";
  else if (t.includes("vehicle") || t.includes("fleet") || t.includes("gps") || t.includes("truck") || t.includes("car")) domain = "fleet";
  else if (t.includes("warehouse") || t.includes("inventory") || t.includes("stock")) domain = "warehouse";
  else if (t.includes("pump") || t.includes("valve") || t.includes("pressure") || t.includes("flow")) domain = "pump";
  else if (t.includes("asset") || t.includes("equipment") || t.includes("sensor") || t.includes("iot")) domain = "iot";

  const hasAlerts    = t.includes("alert") || t.includes("alarm") || t.includes("notif") || t.includes("threshold");
  const hasHistory   = t.includes("histor") || t.includes("trend") || t.includes("time-series") || t.includes("log");
  const hasDashboard = t.includes("dashboard") || t.includes("visual") || t.includes("display") || t.includes("chart") || t.includes("monitor") || t.includes("mashup");
  const hasScheduler = t.includes("schedul") || t.includes("periodic") || t.includes("cron") || t.includes("interval");

  const words = text.split(/\s+/).filter(w => w.length > 3 && !["with","that","this","from","into","have","will","should","build","create","make","generate","need","want","for","and","the","dashboard","monitoring","system"].includes(w.toLowerCase()));
  const projectBase = words.slice(0, 3).join(" ") || "MyProject";
  return { domain, hasAlerts, hasHistory, hasDashboard, hasScheduler, projectBase, raw: text };
}

const DOMAIN_PROPS = {
  temperature: [
    { name:"temperature",    baseType:"NUMBER",   description:"Current temperature reading in °C", persistent:true,  logged:true  },
    { name:"humidity",       baseType:"NUMBER",   description:"Relative humidity %",               persistent:true,  logged:true  },
    { name:"setpoint",       baseType:"NUMBER",   description:"Target temperature setpoint",       persistent:true,  logged:false },
    { name:"unit",           baseType:"STRING",   description:"Temperature unit (C or F)",         persistent:true,  logged:false },
    { name:"sensorStatus",   baseType:"STRING",   description:"Sensor connection status",          persistent:false, logged:false },
    { name:"lastUpdated",    baseType:"DATETIME", description:"Timestamp of last reading",         persistent:true,  logged:false },
    { name:"location",       baseType:"STRING",   description:"Physical location of sensor",       persistent:true,  logged:false },
    { name:"isOverThreshold",baseType:"BOOLEAN",  description:"High temperature alarm flag",       persistent:false, logged:false },
  ],
  cnc: [
    { name:"spindleSpeed",   baseType:"NUMBER",   description:"Spindle RPM",                  persistent:true, logged:true  },
    { name:"feedRate",       baseType:"NUMBER",   description:"Feed rate mm/min",              persistent:true, logged:true  },
    { name:"machineStatus",  baseType:"STRING",   description:"Current machine status",        persistent:true, logged:true  },
    { name:"programNumber",  baseType:"STRING",   description:"Active CNC program number",     persistent:true, logged:false },
    { name:"operatingHours", baseType:"NUMBER",   description:"Total machine operating hours", persistent:true, logged:true  },
    { name:"toolNumber",     baseType:"INTEGER",  description:"Active tool station number",    persistent:true, logged:false },
    { name:"alarmCode",      baseType:"STRING",   description:"Active alarm code if any",      persistent:true, logged:true  },
    { name:"isRunning",      baseType:"BOOLEAN",  description:"Machine running state",         persistent:false,logged:false },
    { name:"partCount",      baseType:"INTEGER",  description:"Parts produced counter",        persistent:true, logged:true  },
    { name:"lastUpdated",    baseType:"DATETIME", description:"Timestamp of last update",      persistent:true, logged:false },
  ],
  water: [
    { name:"phLevel",     baseType:"NUMBER",   description:"pH level 0-14",                persistent:true, logged:true },
    { name:"turbidity",   baseType:"NUMBER",   description:"Turbidity in NTU",             persistent:true, logged:true },
    { name:"dissolvedO2", baseType:"NUMBER",   description:"Dissolved oxygen mg/L",        persistent:true, logged:true },
    { name:"conductivity",baseType:"NUMBER",   description:"Electrical conductivity µS/cm",persistent:true, logged:true },
    { name:"waterTemp",   baseType:"NUMBER",   description:"Water temperature °C",         persistent:true, logged:true },
    { name:"flowRate",    baseType:"NUMBER",   description:"Flow rate L/min",              persistent:true, logged:true },
    { name:"sensorStatus",baseType:"STRING",   description:"Sensor status",                persistent:true, logged:false },
    { name:"lastUpdated", baseType:"DATETIME", description:"Last reading timestamp",       persistent:true, logged:false },
  ],
  energy: [
    { name:"activePower",  baseType:"NUMBER",   description:"Active power in kW",          persistent:true, logged:true },
    { name:"voltage",      baseType:"NUMBER",   description:"Voltage in V",                persistent:true, logged:true },
    { name:"current",      baseType:"NUMBER",   description:"Current in A",                persistent:true, logged:true },
    { name:"powerFactor",  baseType:"NUMBER",   description:"Power factor 0-1",            persistent:true, logged:true },
    { name:"energyTotal",  baseType:"NUMBER",   description:"Total energy consumed kWh",   persistent:true, logged:true },
    { name:"frequency",    baseType:"NUMBER",   description:"Grid frequency Hz",           persistent:true, logged:true },
    { name:"meterStatus",  baseType:"STRING",   description:"Meter status",                persistent:true, logged:false },
    { name:"lastUpdated",  baseType:"DATETIME", description:"Last reading timestamp",      persistent:true, logged:false },
  ],
  fleet: [
    { name:"latitude",    baseType:"NUMBER",   description:"GPS latitude",               persistent:true, logged:true },
    { name:"longitude",   baseType:"NUMBER",   description:"GPS longitude",              persistent:true, logged:true },
    { name:"speed",       baseType:"NUMBER",   description:"Vehicle speed km/h",         persistent:true, logged:true },
    { name:"engineStatus",baseType:"STRING",   description:"Engine on/off status",       persistent:true, logged:true },
    { name:"fuelLevel",   baseType:"NUMBER",   description:"Fuel level %",               persistent:true, logged:true },
    { name:"odometer",    baseType:"NUMBER",   description:"Odometer reading km",        persistent:true, logged:true },
    { name:"driverId",    baseType:"STRING",   description:"Assigned driver ID",         persistent:true, logged:false },
    { name:"lastUpdated", baseType:"DATETIME", description:"Last GPS update timestamp",  persistent:true, logged:false },
  ],
  pump: [
    { name:"flowRate",    baseType:"NUMBER",   description:"Flow rate m³/h",             persistent:true, logged:true },
    { name:"pressure",    baseType:"NUMBER",   description:"Discharge pressure bar",     persistent:true, logged:true },
    { name:"motorCurrent",baseType:"NUMBER",   description:"Motor current A",            persistent:true, logged:true },
    { name:"runningHours",baseType:"NUMBER",   description:"Total running hours",        persistent:true, logged:true },
    { name:"pumpStatus",  baseType:"STRING",   description:"Pump running status",        persistent:true, logged:true },
    { name:"vibration",   baseType:"NUMBER",   description:"Vibration level mm/s",       persistent:true, logged:true },
    { name:"isRunning",   baseType:"BOOLEAN",  description:"Pump on/off state",          persistent:false,logged:false },
    { name:"lastUpdated", baseType:"DATETIME", description:"Last update timestamp",      persistent:true, logged:false },
  ],
  warehouse: [
    { name:"stockLevel",  baseType:"INTEGER",  description:"Current stock quantity",        persistent:true, logged:true },
    { name:"temperature", baseType:"NUMBER",   description:"Storage temperature °C",        persistent:true, logged:true },
    { name:"humidity",    baseType:"NUMBER",   description:"Storage humidity %",            persistent:true, logged:true },
    { name:"zoneId",      baseType:"STRING",   description:"Warehouse zone identifier",     persistent:true, logged:false },
    { name:"lastMovement",baseType:"DATETIME", description:"Last stock movement timestamp", persistent:true, logged:false },
    { name:"doorStatus",  baseType:"STRING",   description:"Door open/closed status",       persistent:true, logged:true },
    { name:"isOccupied",  baseType:"BOOLEAN",  description:"Zone occupied flag",            persistent:false,logged:false },
  ],
  iot: [
    { name:"sensorValue",    baseType:"NUMBER",   description:"Primary sensor reading",       persistent:true, logged:true  },
    { name:"sensorStatus",   baseType:"STRING",   description:"Sensor connection status",     persistent:true, logged:false },
    { name:"batteryLevel",   baseType:"NUMBER",   description:"Battery level %",              persistent:true, logged:true  },
    { name:"signalStrength", baseType:"NUMBER",   description:"RF signal strength dBm",       persistent:true, logged:true  },
    { name:"isOnline",       baseType:"BOOLEAN",  description:"Device online flag",           persistent:false,logged:false },
    { name:"firmwareVersion",baseType:"STRING",   description:"Device firmware version",      persistent:true, logged:false },
    { name:"lastUpdated",    baseType:"DATETIME", description:"Last communication timestamp", persistent:true, logged:false },
  ],
  generic: [
    { name:"value",      baseType:"NUMBER",   description:"Primary measured value",  persistent:true,  logged:true  },
    { name:"status",     baseType:"STRING",   description:"Entity status",           persistent:true,  logged:false },
    { name:"description",baseType:"STRING",   description:"Free text description",  persistent:true,  logged:false },
    { name:"isActive",   baseType:"BOOLEAN",  description:"Active/inactive flag",   persistent:false, logged:false },
    { name:"lastUpdated",baseType:"DATETIME", description:"Last update timestamp",  persistent:true,  logged:false },
  ],
};

const DOMAIN_ALERTS = {
  temperature: [{ prop:"temperature", type:"Above", limit:"80",   name:"HighTempAlert",      priority:"high"   },
                { prop:"temperature", type:"Below", limit:"-10",  name:"LowTempAlert",       priority:"medium" }],
  cnc:         [{ prop:"spindleSpeed",  type:"Above", limit:"12000", name:"OverSpeedAlert",   priority:"high"   },
                { prop:"operatingHours",type:"Above", limit:"500",   name:"MaintenanceDue",   priority:"medium" }],
  water:       [{ prop:"phLevel",   type:"Above", limit:"8.5", name:"HighPhAlert",      priority:"high"   },
                { prop:"phLevel",   type:"Below", limit:"6.5", name:"LowPhAlert",       priority:"high"   },
                { prop:"turbidity", type:"Above", limit:"10",  name:"HighTurbidity",    priority:"medium" }],
  energy:      [{ prop:"activePower", type:"Above", limit:"1000", name:"OverloadAlert",  priority:"high"   },
                { prop:"powerFactor", type:"Below", limit:"0.85", name:"LowPFAlert",     priority:"medium" }],
  pump:        [{ prop:"pressure",  type:"Above", limit:"10", name:"HighPressureAlert", priority:"high"   },
                { prop:"vibration", type:"Above", limit:"7",  name:"HighVibration",     priority:"high"   }],
  fleet:       [{ prop:"speed",     type:"Above", limit:"120", name:"OverSpeedAlert",   priority:"high"   },
                { prop:"fuelLevel", type:"Below", limit:"15",  name:"LowFuelAlert",     priority:"medium" }],
  warehouse:   [{ prop:"temperature",type:"Above", limit:"25", name:"HighTempAlert",    priority:"medium" },
                { prop:"stockLevel", type:"Below", limit:"10", name:"LowStockAlert",    priority:"medium" }],
  iot:         [{ prop:"sensorValue",  type:"Above", limit:"90", name:"HighValueAlert", priority:"medium" },
                { prop:"batteryLevel", type:"Below", limit:"20", name:"LowBattery",     priority:"medium" }],
  generic:     [{ prop:"value", type:"Above", limit:"100", name:"ThresholdAlert",       priority:"medium" }],
};

// ══════════════════════════════════════════════════════════════════════════════
//  XML GENERATORS  (same schemas as real HPMC 9.5 exports)
// ══════════════════════════════════════════════════════════════════════════════
function xmlHeader() { return `<?xml version="1.0" encoding="UTF-8"?>\n<Entities\n majorVersion="9"\n minorVersion="5"\n universal="password">`; }
function xmlFooter() { return `</Entities>`; }

function genProject(ctx) {
  return `${xmlHeader()}
    <Projects>
        <Project
         artifactId=""
         aspect.isExtension="true"
         aspect.projectType="Solution"
         dependsOn="{}"
         description="${ctx.desc}"
         documentationContent=""
         groupId=""
         homeMashup="${ctx.muName}"
         minPlatformVersion=""
         name="${ctx.projectName}"
         packageVersion="${ctx.pkgVersion}"
         projectName="${ctx.projectName}"
         publishResult=""
         state="DRAFT"
         tags="">
            <avatar></avatar>
            <DesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions><Visibility></Visibility></VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables></ConfigurationTables>
        </Project>
    </Projects>
${xmlFooter()}`;
}

function genDataShape(ctx) {
  const fields = ctx.props.map((p, i) => `            <FieldDefinition
             aspect.isPrimaryKey="false"
             baseType="${p.baseType}"
             description="${p.description}"
             name="${p.name}"
             ordinal="${i + 1}"></FieldDefinition>`).join("\n");
  return `${xmlHeader()}
    <DataShapes>
        <DataShape
         aspect.isExtension="true"
         baseDataShape=""
         description="DataShape for ${ctx.label} properties"
         documentationContent=""
         homeMashup=""
         name="${ctx.dsName}"
         projectName="${ctx.projectName}"
         tags="">
            <avatar></avatar>
            <DesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions><Visibility></Visibility></VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables></ConfigurationTables>
            <FieldDefinitions>
${fields}
            </FieldDefinitions>
        </DataShape>
    </DataShapes>
${xmlFooter()}`;
}

function genValueStream(ctx) {
  return `${xmlHeader()}
    <Things>
        <Thing
         aspect.isExtension="true"
         description="ValueStream for ${ctx.label} — PostgreSQL time-series persistence"
         documentationContent=""
         effectiveThingPackage="ValueStreamThing"
         enabled="true"
         homeMashup=""
         identifier=""
         inheritedValueStream=""
         name="${ctx.vsName}"
         projectName="${ctx.projectName}"
         published="false"
         tags=""
         thingTemplate="ValueStream"
         valueStream="">
            <avatar></avatar>
            <DesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions><Visibility></Visibility></VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables>
                <ConfigurationTable
                 dataShapeName=""
                 description="Persistence Provider Settings"
                 isHidden="true"
                 isMultiRow="false"
                 name="PersistenceProviderPackageSettings"
                 ordinal="0">
                    <DataShape>
                        <FieldDefinitions>
                            <FieldDefinition baseType="THINGNAME" description="Persistence provider package" name="persistenceProviderPackageName" ordinal="0"></FieldDefinition>
                        </FieldDefinitions>
                    </DataShape>
                    <Rows>
                        <Row>
                            <persistenceProviderPackageName><![CDATA[PostgreSQLPersistenceProviderPackage]]></persistenceProviderPackageName>
                        </Row>
                    </Rows>
                </ConfigurationTable>
            </ConfigurationTables>
            <ThingShape>
                <PropertyDefinitions></PropertyDefinitions>
                <ServiceDefinitions></ServiceDefinitions>
                <EventDefinitions></EventDefinitions>
                <ServiceMappings></ServiceMappings>
                <ServiceImplementations></ServiceImplementations>
                <Subscriptions></Subscriptions>
            </ThingShape>
            <PropertyBindings></PropertyBindings>
            <RemotePropertyBindings></RemotePropertyBindings>
            <RemoteServiceBindings></RemoteServiceBindings>
            <RemoteEventBindings></RemoteEventBindings>
            <AlertConfigurations></AlertConfigurations>
            <ImplementedShapes></ImplementedShapes>
            <ThingProperties></ThingProperties>
        </Thing>
    </Things>
${xmlFooter()}`;
}

function genThingTemplate(ctx) {
  const propDefs = ctx.props.map((p, i) => `                    <PropertyDefinition
                     aspect.cacheTime="0.0"
                     aspect.dataChangeType="VALUE"
                     aspect.isPersistent="${p.persistent}"
                     aspect.isLogged="${p.logged}"
                     baseType="${p.baseType}"
                     category=""
                     description="${p.description}"
                     isLocalOnly="false"
                     name="${p.name}"
                     ordinal="${i + 1}"></PropertyDefinition>`).join("\n");

  const alertConfigs = ctx.props.map(p => {
    const propAlerts = ctx.alerts.filter(a => a.prop === p.name);
    if (!propAlerts.length) return `                <AlertDefinitions name="${p.name}"></AlertDefinitions>`;
    const inner = propAlerts.map(a => `                    <Alert description="${a.name}" enabled="true" name="${a.name}" priority="${a.priority}" type="${a.type}">
                        <Attributes><limit>${a.limit}</limit></Attributes>
                    </Alert>`).join("\n");
    return `                <AlertDefinitions name="${p.name}">\n${inner}\n                </AlertDefinitions>`;
  }).join("\n");

  const loggedProps = ctx.props.filter(p => p.logged).map(p => `"${p.name}"`).join(",");

  const historyServiceDef = ctx.hasHistory ? `
                    <ServiceDefinition
                     aspect.isAsync="false"
                     category=""
                     description="Query historical property data from ValueStream"
                     isAllowOverride="false"
                     isLocalOnly="false"
                     isOpen="false"
                     isPrivate="false"
                     name="GetHistoricalData">
                        <ResultType baseType="INFOTABLE" description="Historical data" name="result" ordinal="0">
                            <Aspects><Aspect name="dataShape" value="${ctx.dsName}"></Aspect></Aspects>
                        </ResultType>
                        <ParameterDefinitions>
                            <FieldDefinition baseType="DATETIME" description="Start time" name="startDate" ordinal="1"></FieldDefinition>
                            <FieldDefinition baseType="DATETIME" description="End time"   name="endDate"   ordinal="2"></FieldDefinition>
                            <FieldDefinition baseType="INTEGER"  description="Max rows"   name="maxItems"  ordinal="3"></FieldDefinition>
                        </ParameterDefinitions>
                    </ServiceDefinition>` : "";

  const alertServiceDef = ctx.hasAlerts ? `
                    <ServiceDefinition
                     aspect.isAsync="false"
                     category=""
                     description="Evaluate alert thresholds and log active alerts"
                     isAllowOverride="false"
                     isLocalOnly="false"
                     isOpen="false"
                     isPrivate="false"
                     name="CheckAlertThresholds">
                        <ResultType baseType="NOTHING" description="" name="result" ordinal="0"></ResultType>
                        <ParameterDefinitions></ParameterDefinitions>
                    </ServiceDefinition>` : "";

  const historyImpl = ctx.hasHistory ? `
                    <ServiceImplementation description="" handlerName="Script" name="GetHistoricalData">
                        <ConfigurationTables>
                            <ConfigurationTable dataShapeName="" description="" isMultiRow="false" name="Script" ordinal="0">
                                <DataShape><FieldDefinitions><FieldDefinition baseType="STRING" description="code" name="code" ordinal="0"></FieldDefinition></FieldDefinitions></DataShape>
                                <Rows><Row><code><![CDATA[
/*
 * @name        GetHistoricalData
 * @description Query logged property history from ValueStream
 * @param       startDate  DATETIME  Start of query window
 * @param       endDate    DATETIME  End of query window
 * @param       maxItems   INTEGER   Max rows (default 500)
 * @return      INFOTABLE  Matching ${ctx.dsName} rows
 */
var params = {
    startDate     : startDate,
    endDate       : endDate,
    maxItems      : maxItems || 500,
    propertyNames : new Array(${loggedProps})
};
var result = me.QueryPropertyHistory(params);
]]></code></Row></Rows>
                            </ConfigurationTable>
                        </ConfigurationTables>
                    </ServiceImplementation>` : "";

  const alertImpl = ctx.hasAlerts ? `
                    <ServiceImplementation description="" handlerName="Script" name="CheckAlertThresholds">
                        <ConfigurationTables>
                            <ConfigurationTable dataShapeName="" description="" isMultiRow="false" name="Script" ordinal="0">
                                <DataShape><FieldDefinitions><FieldDefinition baseType="STRING" description="code" name="code" ordinal="0"></FieldDefinition></FieldDefinitions></DataShape>
                                <Rows><Row><code><![CDATA[
/*
 * @name        CheckAlertThresholds
 * @description Retrieve active alerts and log them
 */
var activeAlerts = me.GetAlertSummary({ maxItems: 100, filter: undefined });
if (activeAlerts && activeAlerts.rows.length > 0) {
    logger.warn("[" + me.name + "] " + activeAlerts.rows.length + " active alert(s):");
    activeAlerts.rows.toArray().forEach(function(row) {
        logger.warn("  → " + row.name + " | property: " + row.property + " | priority: " + row.priority);
    });
} else {
    logger.info("[" + me.name + "] No active alerts.");
}
]]></code></Row></Rows>
                            </ConfigurationTable>
                        </ConfigurationTables>
                    </ServiceImplementation>` : "";

  const subscription = `
                    <Subscription
                     description="Update lastUpdated on any data change"
                     enabled="true"
                     eventName="DataChange"
                     name="OnDataChange"
                     source=""
                     sourceProperty="${ctx.props[0]?.name || "value"}"
                     sourceType="Thing">
                        <ServiceImplementation description="" handlerName="Script" name="OnDataChange">
                            <ConfigurationTables>
                                <ConfigurationTable dataShapeName="" description="" isMultiRow="false" name="Script" ordinal="0">
                                    <DataShape><FieldDefinitions><FieldDefinition baseType="STRING" description="code" name="code" ordinal="0"></FieldDefinition></FieldDefinitions></DataShape>
                                    <Rows><Row><code><![CDATA[
/*
 * @name        OnDataChange
 * @description Fires when a tracked property changes value
 */
logger.debug("[" + me.name + "] DataChange → " + eventData.propertyName + " = " + eventData.value);
${ctx.props.some(p => p.name === "lastUpdated") ? "me.lastUpdated = new Date();" : "// update timestamp here if needed"}
]]></code></Row></Rows>
                                </ConfigurationTable>
                            </ConfigurationTables>
                        </ServiceImplementation>
                    </Subscription>`;

  return `${xmlHeader()}
    <ThingTemplates>
        <ThingTemplate
         aspect.isExtension="true"
         baseThingTemplate="GenericThing"
         description="ThingTemplate for ${ctx.label}"
         documentationContent=""
         effectiveThingPackage="ConfiguredThing"
         homeMashup="${ctx.muName}"
         inheritedValueStream=""
         name="${ctx.ttName}"
         projectName="${ctx.projectName}"
         tags=""
         thingPackage=""
         valueStream="${ctx.vsName}">
            <avatar></avatar>
            <DesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions><Visibility></Visibility></VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables></ConfigurationTables>
            <PropertyBindings></PropertyBindings>
            <RemotePropertyBindings></RemotePropertyBindings>
            <RemoteServiceBindings></RemoteServiceBindings>
            <RemoteEventBindings></RemoteEventBindings>
            <AlertConfigurations>
${alertConfigs}
            </AlertConfigurations>
            <ThingShape>
                <PropertyDefinitions>
${propDefs}
                </PropertyDefinitions>
                <ServiceDefinitions>${historyServiceDef}${alertServiceDef}
                </ServiceDefinitions>
                <EventDefinitions></EventDefinitions>
                <ServiceMappings></ServiceMappings>
                <ServiceImplementations>${historyImpl}${alertImpl}
                </ServiceImplementations>
                <Subscriptions>${subscription}
                </Subscriptions>
            </ThingShape>
            <ImplementedShapes></ImplementedShapes>
            <SharedConfigurationTables></SharedConfigurationTables>
            <InstanceDesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></InstanceDesignTimePermissions>
            <InstanceRunTimePermissions></InstanceRunTimePermissions>
            <InstanceVisibilityPermissions><Visibility></Visibility></InstanceVisibilityPermissions>
        </ThingTemplate>
    </ThingTemplates>
${xmlFooter()}`;
}

function genThing(ctx) {
  const thingProps = ctx.props.map(p => {
    const def = p.baseType==="NUMBER"?"0.0":p.baseType==="INTEGER"?"0":p.baseType==="BOOLEAN"?"false":p.baseType==="DATETIME"?"1970-01-01T00:00:00.000Z":"";
    return `                <${p.name}>\n                    <Value><![CDATA[${def}]]></Value>\n                    <Timestamp>1970-01-01T00:00:00.000Z</Timestamp>\n                    <Quality>UNKNOWN</Quality>\n                </${p.name}>`;
  }).join("\n");
  return `${xmlHeader()}
    <Things>
        <Thing
         aspect.isExtension="true"
         description="${ctx.label} instance Thing"
         documentationContent=""
         effectiveThingPackage="ConfiguredThing"
         enabled="true"
         homeMashup="${ctx.muName}"
         identifier=""
         inheritedValueStream=""
         name="${ctx.thingName}"
         projectName="${ctx.projectName}"
         published="false"
         tags=""
         thingTemplate="${ctx.ttName}"
         valueStream="">
            <avatar></avatar>
            <DesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></DesignTimePermissions>
            <RunTimePermissions>
                <Permissions resourceName="*">
                    <PropertyRead><Principal isPermitted="true" name="Users" type="Group"></Principal></PropertyRead>
                    <PropertyWrite><Principal isPermitted="true" name="Users" type="Group"></Principal></PropertyWrite>
                    <ServiceInvoke><Principal isPermitted="true" name="Users" type="Group"></Principal></ServiceInvoke>
                    <EventInvoke></EventInvoke>
                    <EventSubscribe></EventSubscribe>
                </Permissions>
            </RunTimePermissions>
            <VisibilityPermissions><Visibility></Visibility></VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables></ConfigurationTables>
            <ThingShape>
                <PropertyDefinitions></PropertyDefinitions>
                <ServiceDefinitions></ServiceDefinitions>
                <EventDefinitions></EventDefinitions>
                <ServiceMappings></ServiceMappings>
                <ServiceImplementations></ServiceImplementations>
                <Subscriptions></Subscriptions>
            </ThingShape>
            <PropertyBindings></PropertyBindings>
            <RemotePropertyBindings></RemotePropertyBindings>
            <RemoteServiceBindings></RemoteServiceBindings>
            <RemoteEventBindings></RemoteEventBindings>
            <AlertConfigurations></AlertConfigurations>
            <ImplementedShapes></ImplementedShapes>
            <ThingProperties>
${thingProps}
            </ThingProperties>
        </Thing>
    </Things>
${xmlFooter()}`;
}

function genMashup(ctx) {
  const numProps = ctx.props.filter(p => p.baseType==="NUMBER"||p.baseType==="INTEGER").slice(0,6);
  const widgets  = numProps.map((p,i) => ({
    wid: `ptcsvaluedisplay-${100+i}`,
    label: p.name.replace(/([A-Z])/g," $1").trim(),
    prop: p.name,
  }));
  const widgetJson = widgets.map(w=>`          {
            "Properties": {
              "Area": "UI", "DisplayName": "${w.label}", "Id": "${w.wid}",
              "Label": "${w.label}", "LabelAlignment": "left", "LastContainer": false,
              "Margin": "8", "ShowDataLoading": true, "Type": "ptcsvaluedisplay",
              "UseTheme": true, "Visible": true, "Z-index": 10,
              "__TypeDisplayName": "Value Display"
            }, "Widgets": []
          }`).join(",\n");

  const svcId = uid();
  const bindings = widgets.map(w=>`    {
      "Id": "${uid()}",
      "PropertyMaps": [{"SourceProperty": "${w.prop}","SourcePropertyBaseType": "NUMBER","SourcePropertyType": "Property","TargetProperty": "Value","TargetPropertyBaseType": "NUMBER","TargetPropertyType": "property"}],
      "SourceArea": "Data","SourceDetails": "AllData","SourceId": "GetProperties","SourceSection": "Things_${ctx.thingName}",
      "TargetArea": "UI","TargetId": "${w.wid}","TargetSection": ""
    }`).join(",\n");

  const mashupContent = `{
  "CustomMashupCss": "",
  "Data": {
    "Things_${ctx.thingName}": {
      "DataName": "Things_${ctx.thingName}","EntityName": "${ctx.thingName}","EntityType": "Things","Id": "${uid()}","RefreshInterval": 10,
      "Services": [{"APIMethod":"get","Characteristic":"Services","Id":"${svcId}","Name":"GetProperties","Parameters":{},"RefreshInterval":10,"Target":"GetProperties"}]
    }
  },
  "DataBindings": [
${bindings}
  ],
  "Events": [{"EventHandlerArea":"Data","EventHandlerId":"Things_${ctx.thingName}","EventHandlerService":"GetProperties","EventTriggerArea":"Mashup","EventTriggerEvent":"Loaded","EventTriggerId":"mashup-root","EventTriggerSection":"","Id":"${uid()}"}],
  "UI": {
    "Properties": {
      "Area":"Mashup","Columns":0,"DisplayName":"Mashup","Height":768,"Id":"mashup-root",
      "MashupResolution":"FHD 1920x1080","ResponsiveLayout":true,"Rows":0,"ShowDataLoading":true,
      "Style":"DefaultMashupStyle","Title":"${ctx.label} Dashboard","TitleBar":true,"TitleBarText":"${ctx.label} Dashboard",
      "Top":0,"Type":"mashup","UseMasterTheme":false,"UseTheme":true,"Visible":true,"Width":1920,"Z-index":10,
      "__TypeDisplayName":"Mashup","id_index":200,"supportsAutoResize":true
    },
    "Widgets": [{
      "Properties":{"Area":"UI","DisplayName":"main-container","Id":"flexcontainer-1","LastContainer":true,"Overlay":false,"ResponsiveLayout":true,"ShowDataLoading":true,"Style":"DefaultContainerStyle","Type":"flexcontainer","UseTheme":true,"Visible":true,"Z-index":10,"__TypeDisplayName":"Responsive Container","align-content":"flex-start","align-items":"flex-start","flex-direction":"column","flex-grow":1,"flex-wrap":"wrap","justify-content":"flex-start","positioning":"responsive","userCannotRemove":true},
      "Widgets": [
        {"Properties":{"Area":"UI","DisplayName":"dashboard-title","Id":"ptcslabel-title","LabelText":"${ctx.label} Dashboard","LabelType":"sub-header","Margin":"10 10 4 10","ShowDataLoading":true,"Type":"ptcslabel","UseTheme":true,"Visible":true,"Z-index":10,"__TypeDisplayName":"Label"},"Widgets":[]},
        {"Properties":{"Area":"UI","DisplayName":"kpi-container","Id":"flexcontainer-kpi","LastContainer":false,"ResponsiveLayout":true,"ShowDataLoading":true,"Style":"DefaultContainerStyle","Type":"flexcontainer","UseTheme":true,"Visible":true,"Z-index":10,"__TypeDisplayName":"Responsive Container","align-content":"flex-start","align-items":"center","flex-direction":"row","flex-grow":1,"flex-wrap":"wrap","justify-content":"flex-start","positioning":"responsive"},
         "Widgets": [
${widgetJson}
         ]}${ctx.hasHistory?`,
        {"Properties":{"Area":"UI","DisplayName":"trend-chart","Id":"ptcschart-trend","ChartType":"line","Margin":"10","ShowDataLoading":true,"Type":"ptcschart","UseTheme":true,"Visible":true,"Z-index":10,"__TypeDisplayName":"Chart","XAxisField":"timestamp","YAxisField":"${numProps[0]?.name||"value"}"},"Widgets":[]}`:""} 
      ]
    }]
  },
  "mashupType":"mashup"
}`;

  return `${xmlHeader()}
    <Mashups>
        <Mashup
         aspect.isExtension="true"
         aspect.isFlex="true"
         aspect.isResponsive="true"
         aspect.mashupType="mashup"
         columns="0.0"
         description="${ctx.label} Dashboard - real-time monitoring"
         documentationContent=""
         homeMashup=""
         name="${ctx.muName}"
         projectName="${ctx.projectName}"
         rows="0.0"
         tags="">
            <avatar></avatar>
            <DesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions><Visibility></Visibility></VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables>
                <ConfigurationTable dataShapeName="" description="Mashup Mobile Settings" isHidden="true" isMultiRow="false" name="MobileSettings" ordinal="0">
                    <DataShape><FieldDefinitions>
                        <FieldDefinition aspect.defaultValue="false" baseType="BOOLEAN" name="disableZoom" ordinal="0"></FieldDefinition>
                        <FieldDefinition aspect.defaultValue="true"  baseType="BOOLEAN" name="fullScreenMode" ordinal="0"></FieldDefinition>
                        <FieldDefinition aspect.defaultValue="1.0"   baseType="NUMBER"  name="initialScale" ordinal="0"></FieldDefinition>
                    </FieldDefinitions></DataShape>
                    <Rows><Row><disableZoom>false</disableZoom><fullScreenMode>true</fullScreenMode><initialScale>1.0</initialScale></Row></Rows>
                </ConfigurationTable>
            </ConfigurationTables>
            <ParameterDefinitions></ParameterDefinitions>
            <Things></Things>
            <ThingShapes></ThingShapes>
            <ThingTemplates></ThingTemplates>
            <mashupContent>
            <![CDATA[
            ${mashupContent}
            ]]>
            </mashupContent>
            <preview></preview>
        </Mashup>
    </Mashups>
${xmlFooter()}`;
}

function genScheduler(ctx) {
  return `${xmlHeader()}
    <Things>
        <Thing
         aspect.isExtension="true"
         description="Scheduler for ${ctx.label} periodic processing"
         documentationContent=""
         effectiveThingPackage="SchedulerThing"
         enabled="true"
         homeMashup=""
         identifier=""
         inheritedValueStream=""
         name="${ctx.schedulerName}"
         projectName="${ctx.projectName}"
         published="false"
         tags=""
         thingTemplate="Scheduler"
         valueStream="">
            <avatar></avatar>
            <DesignTimePermissions><Create></Create><Read></Read><Update></Update><Delete></Delete><Metadata></Metadata></DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions><Visibility></Visibility></VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables>
                <ConfigurationTable dataShapeName="" description="General Settings" isHidden="true" isMultiRow="false" name="Settings" ordinal="0">
                    <DataShape><FieldDefinitions>
                        <FieldDefinition aspect.defaultValue="true"        baseType="BOOLEAN"  description="Enable on startup" name="enabled"    ordinal="0"></FieldDefinition>
                        <FieldDefinition                                    baseType="USERNAME" description="Run-as user"       name="runAsUser"  ordinal="0"></FieldDefinition>
                        <FieldDefinition aspect.defaultValue="0 0/5 * * * ?" baseType="SCHEDULE" description="Cron expression" name="schedule"   ordinal="0"></FieldDefinition>
                    </FieldDefinitions></DataShape>
                    <Rows><Row>
                        <enabled>true</enabled>
                        <runAsUser><![CDATA[Administrator]]></runAsUser>
                        <schedule><![CDATA[0 0/5 * * * ?]]></schedule>
                    </Row></Rows>
                </ConfigurationTable>
            </ConfigurationTables>
            <ThingShape>
                <PropertyDefinitions></PropertyDefinitions>
                <ServiceDefinitions>
                    <ServiceDefinition aspect.isAsync="false" category="" description="Periodic processing for ${ctx.label}" isAllowOverride="false" isLocalOnly="false" isOpen="false" isPrivate="false" name="RunPeriodicTask">
                        <ResultType baseType="NOTHING" description="" name="result" ordinal="0"></ResultType>
                        <ParameterDefinitions></ParameterDefinitions>
                    </ServiceDefinition>
                </ServiceDefinitions>
                <EventDefinitions></EventDefinitions>
                <ServiceMappings></ServiceMappings>
                <ServiceImplementations>
                    <ServiceImplementation description="" handlerName="Script" name="RunPeriodicTask">
                        <ConfigurationTables>
                            <ConfigurationTable dataShapeName="" description="" isMultiRow="false" name="Script" ordinal="0">
                                <DataShape><FieldDefinitions><FieldDefinition baseType="STRING" description="code" name="code" ordinal="0"></FieldDefinition></FieldDefinitions></DataShape>
                                <Rows><Row><code><![CDATA[
/*
 * @name        RunPeriodicTask
 * @description Runs every 5 min — iterates all ${ctx.ttName} Things and checks alerts
 */
logger.info("[${ctx.schedulerName}] Periodic task started at " + new Date());
try {
    var allThings = ThingTemplates["${ctx.ttName}"].QueryImplementingThingsWithData({});
    allThings.rows.toArray().forEach(function(row) {
        var t = Things[row.name];
        logger.info("[${ctx.schedulerName}] Processing: " + row.name);
        if (t.CheckAlertThresholds) { t.CheckAlertThresholds(); }
    });
    logger.info("[${ctx.schedulerName}] Done. Processed " + allThings.rows.length + " thing(s).");
} catch(e) {
    logger.error("[${ctx.schedulerName}] Error: " + e.message);
}
]]></code></Row></Rows>
                            </ConfigurationTable>
                        </ConfigurationTables>
                    </ServiceImplementation>
                </ServiceImplementations>
                <Subscriptions>
                    <Subscription description="Cron trigger" enabled="true" eventName="ScheduledEvent" name="OnScheduledEvent" source="" sourceProperty="" sourceType="Thing">
                        <ServiceImplementation description="" handlerName="Script" name="OnScheduledEvent">
                            <ConfigurationTables>
                                <ConfigurationTable dataShapeName="" description="" isMultiRow="false" name="Script" ordinal="0">
                                    <DataShape><FieldDefinitions><FieldDefinition baseType="STRING" description="code" name="code" ordinal="0"></FieldDefinition></FieldDefinitions></DataShape>
                                    <Rows><Row><code><![CDATA[
logger.info("[" + me.name + "] ScheduledEvent at " + eventTime);
me.RunPeriodicTask();
]]></code></Row></Rows>
                                </ConfigurationTable>
                            </ConfigurationTables>
                        </ServiceImplementation>
                    </Subscription>
                </Subscriptions>
            </ThingShape>
            <PropertyBindings></PropertyBindings>
            <RemotePropertyBindings></RemotePropertyBindings>
            <RemoteServiceBindings></RemoteServiceBindings>
            <RemoteEventBindings></RemoteEventBindings>
            <AlertConfigurations></AlertConfigurations>
            <ImplementedShapes></ImplementedShapes>
            <ThingProperties></ThingProperties>
        </Thing>
    </Things>
${xmlFooter()}`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  METADATA XML  (extension package descriptor)
// ══════════════════════════════════════════════════════════════════════════════
function genMetadata(ctx) {
  const pkgId  = ctx.projectName.toLowerCase().replace(/\./g,"_");
  const vendor = "ThingWorx Agent";
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Entities>
  <ExtensionPackages>
    <ExtensionPackage
      dependsOn=""
      description="${ctx.desc}"
      minimumThingWorxVersion="9.3.5"
      name="${pkgId}"
      packageVersion="${ctx.pkgVersion}"
      vendor="${vendor}">
    </ExtensionPackage>
  </ExtensionPackages>
</Entities>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN GENERATE FUNCTION
// ══════════════════════════════════════════════════════════════════════════════
function generateArtifacts(answers) {
  const info  = parseUseCase(answers.useCase || "");
  const label = toProjectName(info.projectBase);
  const base  = toCamel(info.projectBase);
  const proj  = label.includes(".") ? label : label + ".Core";
  const pkgVer = answers.pkgVersion || "1.0.0";

  const ctx = {
    projectName:   proj,
    dsName:        `${base}.${info.domain}.DS`,
    vsName:        `${base}.${info.domain}.VS`,
    ttName:        `${base}.${info.domain}.TT`,
    thingName:     `${base}.${info.domain}001.Thing`,
    muName:        `${base}.${info.domain}Dashboard.MU`,
    schedulerName: `${base}.${info.domain}.Scheduler`,
    label,
    desc: answers.useCase || "",
    pkgVersion: pkgVer,
    props:       DOMAIN_PROPS[info.domain] || DOMAIN_PROPS.generic,
    alerts:      (answers.wantsAlerts) ? (DOMAIN_ALERTS[info.domain] || DOMAIN_ALERTS.generic) : [],
    hasAlerts:   !!answers.wantsAlerts,
    hasHistory:  !!answers.wantsHistory,
    hasDashboard:!!answers.wantsDashboard,
    hasScheduler:!!answers.wantsScheduler,
    domain: info.domain,
  };

  const artifacts = [];
  let i = 1;
  const add = (filename, entityType, content) => artifacts.push({ filename, entityType, content, folder: ENTITY_FOLDER[entityType] || "Miscellaneous" });

  add(`${String(i++).padStart(2,"0")}_Project.xml`,       "Project",       genProject(ctx));
  add(`${String(i++).padStart(2,"0")}_${info.domain}.DS.xml`, "DataShape",    genDataShape(ctx));
  add(`${String(i++).padStart(2,"0")}_${info.domain}.VS.xml`, "ValueStream",  genValueStream(ctx));
  add(`${String(i++).padStart(2,"0")}_${info.domain}.TT.xml`, "ThingTemplate",genThingTemplate(ctx));
  add(`${String(i++).padStart(2,"0")}_${info.domain}001.Thing.xml`, "Thing",  genThing(ctx));
  if (ctx.hasDashboard) add(`${String(i++).padStart(2,"0")}_dashboard.MU.xml`, "Mashup", genMashup(ctx));
  if (ctx.hasScheduler) add(`${String(i++).padStart(2,"0")}_${info.domain}.Scheduler.xml`, "Scheduler", genScheduler(ctx));

  return { artifacts, ctx };
}

// ══════════════════════════════════════════════════════════════════════════════
//  ZIP BUILDER  — proper ThingWorx Extension package structure
//  zip/
//   ├── metadata.xml
//   └── Entities/
//        ├── Projects/         ← Project XMLs
//        ├── DataShapes/       ← DataShape XMLs
//        ├── ThingTemplates/   ← ThingTemplate XMLs
//        ├── Things/           ← Thing + ValueStream + Scheduler XMLs
//        └── Mashups/          ← Mashup XMLs
// ══════════════════════════════════════════════════════════════════════════════
async function buildExtensionZip(artifacts, ctx) {
  const JSZip = await getJSZip();
  const zip   = new JSZip();

  // metadata.xml at root
  zip.file("metadata.xml", genMetadata(ctx));

  // Each artifact into its folder
  artifacts.forEach(art => {
    const path = `Entities/${art.folder}/${art.filename}`;
    zip.file(path, art.content);
  });

  const blob = await zip.generateAsync({ type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } });
  return blob;
}

// ══════════════════════════════════════════════════════════════════════════════
//  Q&A KNOWLEDGE BASE  — answers questions about the generated project
// ══════════════════════════════════════════════════════════════════════════════
function answerQuestion(question, ctx) {
  if (!ctx) return "No project generated yet. Build a project first, then I can answer questions about it!";
  const q = question.toLowerCase();

  // --- Project / Overview ---
  if (q.includes("project name") || q.includes("what is the project"))
    return `The project is named **${ctx.projectName}** (type: Solution, version: ${ctx.pkgVersion}). It packages all generated entities under one ThingWorx Project entity.`;

  if (q.includes("what did you generate") || q.includes("what was generated") || q.includes("what entities") || q.includes("list") || q.includes("summary"))
    return `For the **${ctx.label}** (${ctx.domain} domain) I generated:\n\n📦 **Project** — ${ctx.projectName}\n📐 **DataShape** — ${ctx.dsName}\n📈 **ValueStream** — ${ctx.vsName} (PostgreSQL)\n🧩 **ThingTemplate** — ${ctx.ttName}\n⚙️ **Thing** — ${ctx.thingName}${ctx.hasDashboard?"\n🖥️ **Mashup** — "+ctx.muName:""}${ctx.hasScheduler?"\n⏰ **Scheduler** — "+ctx.schedulerName:""}`;

  if (q.includes("domain") || q.includes("type of solution"))
    return `The detected domain is **${ctx.domain}**. This determines which properties, alert thresholds and service logic are generated.`;

  if (q.includes("version") || q.includes("package version"))
    return `Package version: **${ctx.pkgVersion}**. You can change this in the metadata.xml inside the ZIP before importing.`;

  // --- Import order ---
  if (q.includes("import order") || q.includes("how to import") || q.includes("import sequence") || q.includes("order of import"))
    return `Import into ThingWorx in this order to satisfy all dependencies:\n\n1. 📦 **Project** (${ctx.projectName})\n2. 📐 **DataShape** (${ctx.dsName})\n3. 📈 **ValueStream** (${ctx.vsName})\n4. 🧩 **ThingTemplate** (${ctx.ttName})\n5. ⚙️ **Thing** (${ctx.thingName})${ctx.hasDashboard?"\n6. 🖥️ **Mashup** ("+ctx.muName+")":""}\n\nOr use **Download ZIP** to get the full Extension package and import it in one step via *Import/Export → Import Extension*.`;

  // --- Extension ZIP ---
  if (q.includes("zip") || q.includes("extension") || q.includes("package") || q.includes("folder structure"))
    return `The **Download ZIP** button creates a proper ThingWorx Extension package:\n\n\`\`\`\nmetadata.xml               ← package descriptor\nEntities/\n  Projects/                ← ${ctx.projectName}.xml\n  DataShapes/              ← ${ctx.dsName}.xml\n  ThingTemplates/          ← ${ctx.ttName}.xml\n  Things/                  ← VS + Thing + Scheduler\n  Mashups/                 ← Dashboard MU\n\`\`\`\n\nImport via: **Import/Export → Import Extension → upload ZIP**.`;

  // --- ValueStream / Persistence ---
  if (q.includes("valuestream") || q.includes("value stream") || q.includes("persist") || q.includes("history") || q.includes("time series") || q.includes("postgresql"))
    return `**ValueStream**: ${ctx.vsName}\n\nConfigured with **PostgreSQLPersistenceProviderPackage**. It stores time-series data for logged properties. The ThingTemplate's \`GetHistoricalData\` service calls \`me.QueryPropertyHistory()\` to retrieve historical data with a time window and max row count.`;

  // --- Properties ---
  if (q.includes("propert") || q.includes("fields"))
    return `The **${ctx.ttName}** has **${ctx.props.length} properties**:\n\n${ctx.props.map(p=>`• **${p.name}** (${p.baseType}) — ${p.description}${p.logged?" 📈 logged":""}${p.persistent?" 💾 persistent":""}`).join("\n")}`;

  // --- Alerts ---
  if (q.includes("alert") || q.includes("alarm") || q.includes("threshold"))
    return ctx.hasAlerts && ctx.alerts.length
      ? `**${ctx.alerts.length} alert(s)** configured on **${ctx.ttName}**:\n\n${ctx.alerts.map(a=>`• **${a.name}** — property \`${a.prop}\` ${a.type} ${a.limit} (priority: ${a.priority})`).join("\n")}\n\nThe \`CheckAlertThresholds\` service reads them via \`me.GetAlertSummary()\`.`
      : `No alerts were generated for this project. Re-run the wizard and answer **Yes** to the alerts question.`;

  // --- Services ---
  if (q.includes("service") || q.includes("method"))
    return `Services on **${ctx.ttName}**:\n\n${ctx.hasHistory?"• **GetHistoricalData**(startDate, endDate, maxItems) → INFOTABLE — queries ValueStream\n":""}${ctx.hasAlerts?"• **CheckAlertThresholds**() → NOTHING — logs active alerts via GetAlertSummary\n":""}• **OnDataChange** (Subscription) — fires on property change, updates \`lastUpdated\``;

  // --- Mashup ---
  if (q.includes("mashup") || q.includes("dashboard") || q.includes("ui") || q.includes("visuali"))
    return ctx.hasDashboard
      ? `**Mashup**: ${ctx.muName}\n\nResponsive layout with:\n• Title label\n• Value Display widgets for each numeric property\n• Data bound to **${ctx.thingName}** via GetProperties (10s auto-refresh)${ctx.hasHistory?"\n• Line chart for historical trend":""}\n\nSet as \`homeMashup\` on both Project and ThingTemplate.`
      : `No Mashup was generated. Re-run and choose **Yes** to the dashboard question.`;

  // --- Scheduler ---
  if (q.includes("schedul") || q.includes("cron") || q.includes("periodic"))
    return ctx.hasScheduler
      ? `**Scheduler**: ${ctx.schedulerName}\n\nCron expression: \`0 0/5 * * * ?\` (every 5 minutes)\n\nOn each trigger it:\n1. Queries all Things implementing **${ctx.ttName}**\n2. Calls \`CheckAlertThresholds()\` on each\n3. Logs counts and errors\n\nChange the cron in the ConfigurationTable \`Settings → schedule\`.`
      : `No Scheduler was generated. Re-run and choose **Yes** to the scheduler question.`;

  // --- ThingTemplate ---
  if (q.includes("thingtemplate") || q.includes("thing template") || q.includes("template"))
    return `**ThingTemplate**: ${ctx.ttName}\n\n• Base: \`GenericThing\`\n• ValueStream: ${ctx.vsName}\n• ${ctx.props.length} properties, ${ctx.props.filter(p=>p.logged).length} logged to ValueStream\n• ${ctx.hasAlerts?ctx.alerts.length+" alert rule(s)":"No alerts"}\n• Services: ${[ctx.hasHistory?"GetHistoricalData":null,ctx.hasAlerts?"CheckAlertThresholds":null].filter(Boolean).join(", ")||"(none)"}\n• Subscription: OnDataChange`;

  // --- Thing ---
  if (q.includes("thing") && !q.includes("template"))
    return `**Thing**: ${ctx.thingName}\n\n• Template: ${ctx.ttName}\n• All ${ctx.props.length} properties pre-initialized with default values\n• \`Users\` group has PropertyRead/Write/ServiceInvoke permissions\n• Inherits all services, alerts and subscriptions from the ThingTemplate`;

  // --- DataShape ---
  if (q.includes("datashape") || q.includes("data shape") || q.includes("schema") || q.includes("field"))
    return `**DataShape**: ${ctx.dsName}\n\n${ctx.props.length} fields: ${ctx.props.map(p=>`\`${p.name}\` (${p.baseType})`).join(", ")}\n\nUsed as return type for \`GetHistoricalData\` and as the data contract for ValueStream queries.`;

  // --- Naming ---
  if (q.includes("naming") || q.includes("convention") || q.includes("camel"))
    return `All entities use **camelCase** naming with domain-aware suffixes:\n\n• \`.DS\` → DataShape\n• \`.VS\` → ValueStream\n• \`.TT\` → ThingTemplate\n• \`.Thing\` → Thing instance\n• \`.MU\` → Mashup\n• \`.Scheduler\` → Scheduler Thing\n\nProject name uses **PascalCase dot-notation** (e.g. \`${ctx.projectName}\`).`;

  // --- General ThingWorx questions ---
  if (q.includes("what is thingworx"))
    return `**ThingWorx** is PTC's Industrial IoT platform. It lets you model physical assets as **Things**, collect sensor data, run business logic in JavaScript services, and build **Mashup** dashboards — all without writing traditional front-end code.`;

  if (q.includes("what is a thing") && !q.includes("template"))
    return `A **Thing** in ThingWorx is a digital twin of a physical or logical entity (sensor, machine, product). It has:\n• **Properties** — real-time state values\n• **Services** — JavaScript methods\n• **Events** — triggers\n• **Subscriptions** — event handlers\n\nThings inherit their shape from a **ThingTemplate**.`;

  if (q.includes("what is a thingtemplate") || q.includes("what is a thing template"))
    return `A **ThingTemplate** is a reusable blueprint for Things — like a class in OOP. It defines shared properties, services, and alerts. All Things implementing the template inherit its definition. Best practice: always create a ThingTemplate even for single instances.`;

  if (q.includes("what is a datashape"))
    return `A **DataShape** defines the schema of an InfoTable (ThingWorx's typed result set). It's used as the return type for services, stream storage schemas, and configuration table structures.`;

  if (q.includes("what is a valuestream"))
    return `A **ValueStream** is a special ThingWorx entity that persists time-series property data to a database (PostgreSQL in your setup). Properties marked \`isLogged=true\` on a Thing automatically write to its ValueStream on every value change.`;

  if (q.includes("what is a mashup"))
    return `A **Mashup** is ThingWorx's drag-and-drop UI builder output. It's stored as a JSON blob inside XML. Widgets (labels, dropdowns, charts, value displays) are wired to Thing services via DataBindings and Events.`;

  // --- Fallback ---
  return `I can answer questions about **${ctx.projectName}** including:\n\n• Entity names and structure\n• Import order & Extension ZIP format\n• Properties, services, alerts\n• ValueStream / persistence setup\n• Mashup & Scheduler details\n• ThingWorx concepts (Thing, ThingTemplate, DataShape…)\n\nAsk me anything specific!`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  UI CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const ENTITY_ICONS   = { Project:"📦", DataShape:"📐", ValueStream:"📈", ThingTemplate:"🧩", Thing:"⚙️", Mashup:"🖥️", Scheduler:"⏰" };
const ENTITY_COLORS  = {
  Project:      { bg:"#1e3a5f", accent:"#4a9eff" },
  DataShape:    { bg:"#1a3d2e", accent:"#4ade80" },
  ValueStream:  { bg:"#3d1f3d", accent:"#c084fc" },
  ThingTemplate:{ bg:"#3d2b1a", accent:"#fb923c" },
  Thing:        { bg:"#1a2e3d", accent:"#38bdf8" },
  Mashup:       { bg:"#3d1a1a", accent:"#f87171" },
  Scheduler:    { bg:"#2d2d1a", accent:"#facc15" },
};
const QUICK_PROMPTS = [
  "Temperature sensor dashboard with alerts",
  "CNC machine monitoring with OEE",
  "Water quality monitoring system",
  "Energy meter dashboard with trends",
  "Fleet vehicle tracking with GPS",
  "Pump monitoring with vibration alerts",
];
const FLOW = { IDLE:"IDLE", ASK_ALERTS:"ASK_ALERTS", ASK_HISTORY:"ASK_HISTORY", ASK_DASH:"ASK_DASH", ASK_SCHED:"ASK_SCHED", ASK_VER:"ASK_VER", DONE:"DONE" };

// ── Q&A suggested questions ───────────────────────────────────────────
const QA_SUGGESTIONS = [
  "What entities were generated?",
  "How do I import this?",
  "Explain the Extension ZIP structure",
  "What properties does the ThingTemplate have?",
  "How does the ValueStream work?",
  "What alerts are configured?",
  "Explain the Scheduler",
  "What is the import order?",
];

function syntaxColor(line) {
  const t = line.trimStart();
  if (t.startsWith("<?xml"))           return "#4a6080";
  if (t.startsWith("<!--"))            return "#4a5568";
  if (t.startsWith("<![CDATA[") || t.startsWith("]]>")) return "#7c3aed";
  if (/^<\/[A-Z]/.test(t))             return "#60a5fa";
  if (/^<[A-Z][a-zA-Z]+/.test(t))      return "#f59e0b";
  if (/^<\/[a-z]/.test(t))             return "#60a5fa";
  if (/^<[a-z]/.test(t))               return "#34d399";
  return "#94a3b8";
}

function renderMd(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g,     `<code style="background:#1e2d4a;padding:1px 5px;border-radius:3px;font-size:10.5px;font-family:monospace">$1</code>`)
    .replace(/_(.*?)_/g,       "<em>$1</em>")
    .replace(/\n/g,            "<br/>");
}

// ══════════════════════════════════════════════════════════════════════════════
//  ROOT COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function ThingWorxAgentV2() {
  // ── Build wizard state ────────────────────────────────────────────
  const [wizMessages, setWizMessages] = useState([]);
  const [flowState,   setFlowState]   = useState(FLOW.IDLE);
  const [answers,     setAnswers]     = useState({});
  const [wizInput,    setWizInput]    = useState("");
  const [generating,  setGenerating]  = useState(false);

  // ── Generated artifacts ───────────────────────────────────────────
  const [artifacts,   setArtifacts]   = useState([]);
  const [ctx,         setCtx]         = useState(null);
  const [selectedArt, setSelectedArt] = useState(null);
  const [copied,      setCopied]      = useState(false);
  const [zipping,     setZipping]     = useState(false);

  // ── Q&A chatbot state ─────────────────────────────────────────────
  const [qaMessages,  setQaMessages]  = useState([
    { id:"qa-welcome", role:"bot", text:"👋 Hi! I'm your **ThingWorx Q&A assistant**.\n\nOnce you generate a project on the left I can answer questions about it — import order, entity names, properties, alerts, the Extension ZIP structure, and general ThingWorx concepts.\n\nTry one of the suggestions below or ask anything!" }
  ]);
  const [qaInput,     setQaInput]     = useState("");

  // ── Active panel (XML viewer vs Q&A) ─────────────────────────────
  const [rightTab,    setRightTab]    = useState("xml"); // "xml" | "qa"

  const wizEnd  = useRef(null);
  const qaEnd   = useRef(null);
  const wizArea = useRef(null);
  const qaArea  = useRef(null);

  useEffect(() => { wizEnd.current?.scrollIntoView({behavior:"smooth"}); }, [wizMessages, generating]);
  useEffect(() => { qaEnd.current?.scrollIntoView({behavior:"smooth"});  }, [qaMessages]);

  // ── Init wizard greeting ──────────────────────────────────────────
  useEffect(() => {
    addWiz(`👋 Welcome to the **ThingWorx AI Development Agent v2**

100% free · local · no API · TWX 9.5 · PostgreSQL

I'll generate a complete **Extension Package ZIP** ready for ThingWorx import, with the proper folder structure:
\`Entities/Projects/\`  \`DataShapes/\`  \`ThingTemplates/\`  \`Things/\`  \`Mashups/\`  + \`metadata.xml\`

Describe your use case or pick a quick start:`, "intro");
  }, []);

  function addWiz(text, id, opts={}) {
    setWizMessages(prev => [...prev, { id: id||uid(), role:"bot", text, ...opts }]);
  }
  function addUser(text) {
    setWizMessages(prev => [...prev, { id:uid(), role:"user", text }]);
  }

  function wizAutoResize() {
    if (!wizArea.current) return;
    wizArea.current.style.height = "auto";
    wizArea.current.style.height = Math.min(wizArea.current.scrollHeight,160)+"px";
  }
  function qaAutoResize() {
    if (!qaArea.current) return;
    qaArea.current.style.height = "auto";
    qaArea.current.style.height = Math.min(qaArea.current.scrollHeight,120)+"px";
  }

  // ── Wizard flow handler ───────────────────────────────────────────
  async function handleWizInput(text) {
    if (!text.trim()) return;
    addUser(text);
    setWizInput("");
    if (wizArea.current) wizArea.current.style.height = "auto";

    if (flowState === FLOW.IDLE || flowState === FLOW.DONE) {
      setAnswers({ useCase: text });
      setFlowState(FLOW.ASK_ALERTS);
      addWiz("Should I include **threshold alerts** on properties? (e.g. high-temp alarm, over-pressure alert)", uid(),
        { choices:["✅ Yes, add alerts","❌ No alerts"] });

    } else if (flowState === FLOW.ASK_ALERTS) {
      const wa = /yes|✅|alert|alarm|y\b/i.test(text);
      const na = { ...answers, wantsAlerts: wa };
      setAnswers(na);
      setFlowState(FLOW.ASK_HISTORY);
      addWiz("Include **historical data querying** via ValueStream? (trend charts, time-range queries)", uid(),
        { choices:["✅ Yes, historical data","❌ Real-time only"] });

    } else if (flowState === FLOW.ASK_HISTORY) {
      const wh = /yes|✅|histor|trend|time/i.test(text);
      const na = { ...answers, wantsHistory: wh };
      setAnswers(na);
      setFlowState(FLOW.ASK_DASH);
      addWiz("Generate a **Mashup dashboard** with value displays and charts?", uid(),
        { choices:["✅ Yes, Mashup dashboard","❌ Backend entities only"] });

    } else if (flowState === FLOW.ASK_DASH) {
      const wd = /yes|✅|dash|mashup|visual/i.test(text);
      const na = { ...answers, wantsDashboard: wd };
      setAnswers(na);
      setFlowState(FLOW.ASK_SCHED);
      addWiz("Add a **Scheduler** for periodic tasks? (e.g. alert checks every 5 min)", uid(),
        { choices:["✅ Yes, Scheduler","❌ No Scheduler"] });

    } else if (flowState === FLOW.ASK_SCHED) {
      const ws = /yes|✅|sched|cron|periodic/i.test(text);
      const na = { ...answers, wantsScheduler: ws };
      setAnswers(na);
      setFlowState(FLOW.ASK_VER);
      addWiz("What **package version** should the Extension use?", uid(),
        { choices:["1.0.0","1.0.1","2.0.0","Custom…"] });

    } else if (flowState === FLOW.ASK_VER) {
      const ver = /custom/i.test(text) ? "1.0.0" : (text.match(/\d+\.\d+\.\d+/)||["1.0.0"])[0];
      const finalAns = { ...answers, pkgVersion: ver };
      setAnswers(finalAns);
      setFlowState(FLOW.DONE);
      setGenerating(true);
      addWiz("⚙️ Generating ThingWorx 9.5 artifacts + Extension ZIP…", uid());

      setTimeout(() => {
        const { artifacts: arts, ctx: newCtx } = generateArtifacts(finalAns);
        setArtifacts(arts);
        setCtx(newCtx);
        setSelectedArt(arts[0]);
        setGenerating(false);
        setRightTab("xml");

        const summary = arts.map(a=>`  ${ENTITY_ICONS[a.entityType]} **${a.filename}** → \`Entities/${a.folder}/\``).join("\n");
        addWiz(
          `✅ **${arts.length} artifacts** generated for **${newCtx.projectName}** v${ver}\n\nExtension ZIP structure:\n${summary}\n  📄 **metadata.xml** → package root\n\nClick **⬇ Download ZIP** to get the import-ready extension package.\nSwitch to the **Q&A tab** to ask questions about what was built.\n\nWant a different solution? Just describe it!`,
          uid(), { arts }
        );
      }, 350);
    }
  }

  // ── Q&A handler ───────────────────────────────────────────────────
  function handleQaInput(text) {
    if (!text.trim()) return;
    const userMsg = { id:uid(), role:"user", text };
    const answer  = answerQuestion(text, ctx);
    const botMsg  = { id:uid(), role:"bot", text: answer };
    setQaMessages(prev => [...prev, userMsg, botMsg]);
    setQaInput("");
    if (qaArea.current) qaArea.current.style.height = "auto";
  }

  // ── ZIP download ──────────────────────────────────────────────────
  async function handleZipDownload() {
    if (!artifacts.length || !ctx) return;
    setZipping(true);
    try {
      const blob = await buildExtensionZip(artifacts, ctx);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const pkgId = ctx.projectName.toLowerCase().replace(/\./g,"_");
      a.href = url;
      a.download = `${pkgId}_v${ctx.pkgVersion}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      alert("ZIP generation failed: " + e.message);
    } finally {
      setZipping(false);
    }
  }

  function downloadOne(art) {
    const blob = new Blob([art.content],{type:"application/xml"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href=url; a.download=art.filename; a.click();
    URL.revokeObjectURL(url);
  }

  function copyXml() {
    if (!selectedArt) return;
    navigator.clipboard.writeText(selectedArt.content);
    setCopied(true);
    setTimeout(()=>setCopied(false),2000);
  }

  // ══════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════
  const S = {
    root:    { display:"flex", height:"100vh", background:"#08090f", fontFamily:"'JetBrains Mono','Fira Code',monospace", color:"#e2e8f0", overflow:"hidden" },
    panel:   { display:"flex", flexDirection:"column", borderRight:"1px solid #1a2540" },
    hdr:     { padding:"12px 16px", background:"#0b0f1e", borderBottom:"1px solid #1a2540", display:"flex", alignItems:"center", gap:10, flexShrink:0 },
    msgs:    { flex:1, overflowY:"auto", padding:"14px 12px", display:"flex", flexDirection:"column", gap:10 },
    bubble:  (role) => ({ maxWidth:"86%", padding:"9px 13px", borderRadius: role==="user"?"14px 4px 14px 14px":"4px 14px 14px 14px", background: role==="user"?"#1d3461":"#0f1929", border:`1px solid ${role==="user"?"#2563eb30":"#1a2540"}`, fontSize:12, lineHeight:1.7, color:"#cbd5e1" }),
    inp:     { padding:"10px 12px", borderTop:"1px solid #1a2540", background:"#08090f", flexShrink:0 },
    inpBox:  { display:"flex", gap:7, alignItems:"flex-end", background:"#0f1929", border:"1px solid #1a3050", borderRadius:9, padding:"7px 11px" },
    btn:     (active) => ({ background: active?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"#1a2540", border:"none", borderRadius:7, width:30, height:30, cursor: active?"pointer":"not-allowed", color:"#fff", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }),
    chip:    (col, active) => ({ background: active?col.accent+"22":col.bg, border:`1px solid ${active?col.accent:col.accent+"40"}`, borderRadius:5, padding:"3px 8px", cursor:"pointer", color:col.accent, fontSize:10, fontWeight:600, display:"flex", alignItems:"center", gap:4, fontFamily:"inherit" }),
    tab:     (active) => ({ background:"transparent", border:"none", borderBottom: active?"2px solid #4a9eff":"2px solid transparent", padding:"8px 16px", cursor:"pointer", color: active?"#4a9eff":"#334155", fontSize:11, fontWeight:600, fontFamily:"inherit", whiteSpace:"nowrap", transition:"all 0.15s" }),
  };

  return (
    <div style={S.root}>

      {/* ═══ LEFT: Build Wizard ═══════════════════════════════════════ */}
      <div style={{ ...S.panel, flex:"0 0 380px" }}>
        {/* Header */}
        <div style={S.hdr}>
          <div style={{ width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#1d4ed8,#7c3aed)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,boxShadow:"0 0 12px #7c3aed44" }}>⚡</div>
          <div>
            <div style={{ fontWeight:700,fontSize:13,color:"#fff" }}>Build Wizard</div>
            <div style={{ fontSize:10,color:"#4a9eff",marginTop:1 }}>TWX 9.5 · PostgreSQL · Extension ZIP</div>
          </div>
          <div style={{ marginLeft:"auto",fontSize:9,padding:"3px 8px",borderRadius:4,background:"#0d1b33",color:"#22c55e",border:"1px solid #166534",fontWeight:600 }}>● LOCAL</div>
        </div>

        {/* Messages */}
        <div style={S.msgs}>
          {wizMessages.map(msg => (
            <div key={msg.id}>
              <div style={{ display:"flex", gap:9, flexDirection:msg.role==="user"?"row-reverse":"row", alignItems:"flex-start" }}>
                <div style={{ width:26,height:26,borderRadius:"50%",flexShrink:0,background:msg.role==="user"?"linear-gradient(135deg,#1d4ed8,#3b82f6)":"linear-gradient(135deg,#059669,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff" }}>
                  {msg.role==="user"?"U":"⚡"}
                </div>
                <div style={S.bubble(msg.role)}>
                  <span dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }} />
                </div>
              </div>

              {/* Quick prompts */}
              {msg.id==="intro" && flowState===FLOW.IDLE && (
                <div style={{ marginTop:8,marginLeft:35,display:"flex",flexDirection:"column",gap:5 }}>
                  {QUICK_PROMPTS.map(p=>(
                    <button key={p} onClick={()=>handleWizInput(p)} style={{ background:"#0d1929",border:"1px solid #1a3050",borderRadius:6,padding:"6px 11px",cursor:"pointer",color:"#7dd3fc",fontSize:11,fontWeight:600,textAlign:"left",fontFamily:"inherit" }}>
                      💡 {p}
                    </button>
                  ))}
                </div>
              )}

              {/* Choice buttons */}
              {msg.choices && (
                <div style={{ marginTop:7,marginLeft:35,display:"flex",flexWrap:"wrap",gap:5 }}>
                  {msg.choices.map(c=>(
                    <button key={c} onClick={()=>handleWizInput(c)} style={{ background:"#0d1929",border:"1px solid #1a3050",borderRadius:6,padding:"5px 11px",cursor:"pointer",color:"#94a3b8",fontSize:11,fontWeight:600,fontFamily:"inherit" }}>{c}</button>
                  ))}
                </div>
              )}

              {/* Artifact chips */}
              {msg.arts?.length>0 && (
                <div style={{ marginTop:7,marginLeft:35,display:"flex",flexWrap:"wrap",gap:4 }}>
                  {msg.arts.map(art=>{
                    const col = ENTITY_COLORS[art.entityType]||ENTITY_COLORS.Thing;
                    return (
                      <button key={art.filename} onClick={()=>{setSelectedArt(art);setRightTab("xml");}} style={S.chip(col,selectedArt?.filename===art.filename)}>
                        {ENTITY_ICONS[art.entityType]} {art.filename}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {generating && (
            <div style={{ display:"flex",gap:9,alignItems:"flex-start" }}>
              <div style={{ width:26,height:26,borderRadius:"50%",background:"linear-gradient(135deg,#059669,#10b981)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff" }}>⚡</div>
              <div style={{ ...S.bubble("bot"), display:"flex",gap:5,alignItems:"center" }}>
                {[0,1,2].map(i=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:"#3b82f6",animation:"blink 1.2s infinite",animationDelay:`${i*0.2}s` }} />)}
                <span style={{ fontSize:11,color:"#64748b",marginLeft:5 }}>Building…</span>
              </div>
            </div>
          )}
          <div ref={wizEnd} />
        </div>

        {/* Input */}
        <div style={S.inp}>
          <div style={S.inpBox}>
            <textarea ref={wizArea} value={wizInput} onChange={e=>{setWizInput(e.target.value);wizAutoResize();}}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleWizInput(wizInput);}}}
              placeholder="Describe your ThingWorx solution…"
              rows={1}
              style={{ flex:1,background:"transparent",border:"none",outline:"none",color:"#e2e8f0",fontSize:12,resize:"none",lineHeight:1.5,fontFamily:"inherit",maxHeight:160 }}
            />
            <button onClick={()=>handleWizInput(wizInput)} disabled={!wizInput.trim()} style={S.btn(!!wizInput.trim())}>→</button>
          </div>
          <div style={{ fontSize:9,color:"#1e2d4a",marginTop:4,textAlign:"center" }}>Enter · 100% local, zero cost</div>
        </div>
      </div>

      {/* ═══ RIGHT: XML Viewer + Q&A ══════════════════════════════════ */}
      <div style={{ flex:1,display:"flex",flexDirection:"column",background:"#06080e",minWidth:0 }}>

        {/* Right panel tab bar */}
        <div style={{ display:"flex",alignItems:"center",background:"#0a0e1a",borderBottom:"1px solid #1a2540",flexShrink:0,paddingLeft:4 }}>
          <button style={S.tab(rightTab==="xml")}   onClick={()=>setRightTab("xml")}>📄 XML Viewer</button>
          <button style={S.tab(rightTab==="qa")}    onClick={()=>setRightTab("qa")}>💬 Q&A Assistant</button>
          <button style={S.tab(rightTab==="struct")}onClick={()=>setRightTab("struct")}>📁 ZIP Structure</button>

          {/* Action buttons */}
          <div style={{ marginLeft:"auto",display:"flex",gap:6,paddingRight:12 }}>
            {artifacts.length>0 && (
              <>
                <button onClick={handleZipDownload} disabled={zipping} style={{ background: zipping?"#1a2540":"linear-gradient(135deg,#059669,#0d9488)",border:"none",borderRadius:6,padding:"5px 12px",cursor:zipping?"not-allowed":"pointer",color:"#fff",fontSize:11,fontWeight:700,fontFamily:"inherit",display:"flex",alignItems:"center",gap:5 }}>
                  {zipping?"⏳ Building…":"📦 Download ZIP"}
                </button>
                <button onClick={()=>artifacts.forEach((a,i)=>setTimeout(()=>downloadOne(a),i*100))} style={{ background:"#1a2540",border:"1px solid #1e3a5f",borderRadius:6,padding:"5px 10px",cursor:"pointer",color:"#94a3b8",fontSize:11,fontWeight:600,fontFamily:"inherit" }}>
                  ⬇ All XML
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── XML Viewer ── */}
        {rightTab==="xml" && (
          selectedArt ? (
            <div style={{ flex:1,display:"flex",flexDirection:"column",minHeight:0 }}>
              {/* XML toolbar */}
              <div style={{ padding:"10px 16px",borderBottom:"1px solid #1a2540",background:"#0b0f1e",display:"flex",alignItems:"center",gap:9,flexShrink:0 }}>
                <span style={{ fontSize:18 }}>{ENTITY_ICONS[selectedArt.entityType]||"📄"}</span>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:12,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{selectedArt.filename}</div>
                  <div style={{ fontSize:10,color:"#64748b",marginTop:1 }}>
                    {selectedArt.entityType} · Entities/{selectedArt.folder}/ · {selectedArt.content.split("\n").length} lines
                  </div>
                </div>
                <button onClick={copyXml} style={{ background:copied?"#059669":"#1a2540",border:`1px solid ${copied?"#059669":"#1e3a5f"}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",color:copied?"#fff":"#94a3b8",fontSize:11,fontWeight:600,fontFamily:"inherit",flexShrink:0,transition:"all 0.2s" }}>
                  {copied?"✓ Copied":"Copy"}
                </button>
                <button onClick={()=>downloadOne(selectedArt)} style={{ background:"#1a2540",border:"1px solid #1e3a5f",borderRadius:6,padding:"4px 10px",cursor:"pointer",color:"#94a3b8",fontSize:11,fontWeight:600,fontFamily:"inherit",flexShrink:0 }}>
                  ⬇
                </button>
              </div>

              {/* File tabs */}
              {artifacts.length>1 && (
                <div style={{ display:"flex",overflowX:"auto",background:"#08090f",borderBottom:"1px solid #1a2540",flexShrink:0 }}>
                  {artifacts.map(art=>{
                    const col=ENTITY_COLORS[art.entityType]||ENTITY_COLORS.Thing;
                    const active=selectedArt?.filename===art.filename;
                    return <button key={art.filename} onClick={()=>setSelectedArt(art)} style={{ background:"transparent",border:"none",borderBottom:active?`2px solid ${col.accent}`:"2px solid transparent",padding:"6px 12px",cursor:"pointer",color:active?col.accent:"#334155",fontSize:10,fontWeight:600,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0 }}>
                      {ENTITY_ICONS[art.entityType]} {art.filename.replace(/^\d+_/,"")}
                    </button>;
                  })}
                </div>
              )}

              {/* XML content */}
              <div style={{ flex:1,overflow:"auto" }}>
                <pre style={{ margin:0,padding:"14px 0",fontSize:11,lineHeight:1.75,fontFamily:"'JetBrains Mono','Fira Code',monospace",tabSize:4 }}>
                  {selectedArt.content.split("\n").map((line,i)=>(
                    <div key={i} style={{ display:"flex",minHeight:"1.75em" }}>
                      <span style={{ display:"inline-block",width:42,textAlign:"right",color:"#1e2d4a",userSelect:"none",paddingRight:12,flexShrink:0,fontSize:10,paddingTop:1 }}>{i+1}</span>
                      <span style={{ color:syntaxColor(line),paddingRight:18 }}>{line||" "}</span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          ) : (
            <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:"#1a2540" }}>
              <div style={{ fontSize:48,filter:"grayscale(1) opacity(0.25)" }}>⚙️</div>
              <div style={{ fontSize:13,fontWeight:700 }}>XML Viewer</div>
              <div style={{ fontSize:11,color:"#0f2040",textAlign:"center",maxWidth:260,lineHeight:1.6 }}>
                Generate a project with the Build Wizard on the left, then click any entity to inspect its XML here.
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:4 }}>
                {Object.entries(ENTITY_ICONS).map(([t,ic])=>(
                  <div key={t} style={{ display:"flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:4,background:"#0a0e1a",border:"1px solid #0f1f33",color:"#1a2d3d",fontSize:10 }}>
                    <span style={{ opacity:0.35 }}>{ic}</span><span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {/* ── ZIP Structure view ── */}
        {rightTab==="struct" && (
          <div style={{ flex:1,overflow:"auto",padding:"20px 24px" }}>
            <div style={{ fontSize:13,fontWeight:700,color:"#4a9eff",marginBottom:16 }}>📦 Extension ZIP Structure</div>
            {ctx ? (
              <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:12,lineHeight:2.2 }}>
                {[
                  { indent:0, icon:"📦", label: ctx.projectName.toLowerCase().replace(/\./g,"_")+`_v${ctx.pkgVersion}.zip`, color:"#f59e0b" },
                  { indent:1, icon:"📄", label:"metadata.xml", color:"#94a3b8", note:"Extension package descriptor — name, version, vendor, dependsOn" },
                  { indent:1, icon:"📁", label:"Entities/", color:"#4a9eff" },
                  { indent:2, icon:"📁", label:"Projects/", color:"#4ade80" },
                  { indent:3, icon:"📄", label: artifacts.find(a=>a.entityType==="Project")?.filename||"—", color:"#4ade80" },
                  { indent:2, icon:"📁", label:"DataShapes/", color:"#4ade80" },
                  { indent:3, icon:"📄", label: artifacts.find(a=>a.entityType==="DataShape")?.filename||"—", color:"#4ade80" },
                  { indent:2, icon:"📁", label:"ThingTemplates/", color:"#fb923c" },
                  { indent:3, icon:"📄", label: artifacts.find(a=>a.entityType==="ThingTemplate")?.filename||"—", color:"#fb923c" },
                  { indent:2, icon:"📁", label:"Things/", color:"#38bdf8" },
                  ...artifacts.filter(a=>ENTITY_FOLDER[a.entityType]==="Things").map(a=>({ indent:3, icon:"📄", label:a.filename, color:"#38bdf8", sub:a.entityType })),
                  ...(artifacts.some(a=>a.entityType==="Mashup") ? [
                    { indent:2, icon:"📁", label:"Mashups/", color:"#f87171" },
                    { indent:3, icon:"📄", label: artifacts.find(a=>a.entityType==="Mashup")?.filename||"—", color:"#f87171" },
                  ] : []),
                ].map((row,i)=>(
                  <div key={i} style={{ display:"flex",alignItems:"center",gap:8,paddingLeft:row.indent*20,opacity:row.label==="—"?0.3:1 }}>
                    <span>{row.icon}</span>
                    <span style={{ color:row.color,fontWeight:row.indent<=1?700:400 }}>{row.label}</span>
                    {row.sub && <span style={{ fontSize:9,color:"#475569",background:"#0f1929",padding:"1px 5px",borderRadius:3 }}>{row.sub}</span>}
                    {row.note && <span style={{ fontSize:10,color:"#334155",marginLeft:6 }}>{row.note}</span>}
                  </div>
                ))}

                <div style={{ marginTop:24,padding:"14px 16px",background:"#0d1929",borderRadius:8,border:"1px solid #1a3050" }}>
                  <div style={{ fontSize:11,fontWeight:700,color:"#4a9eff",marginBottom:10 }}>How to import in ThingWorx</div>
                  {[
                    "1. Click the green  📦 Download ZIP  button above",
                    "2. Open ThingWorx Composer",
                    `3. Go to  Import/Export → Import Extension`,
                    "4. Select the downloaded .zip file",
                    "5. ThingWorx will import all entities in the correct dependency order",
                    "6. Verify all entities appear in the Entity Browser",
                  ].map((s,i)=>(
                    <div key={i} style={{ fontSize:11,color:"#64748b",lineHeight:1.8 }}>{s}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color:"#1a3050",fontSize:12 }}>Generate a project first to see its ZIP structure here.</div>
            )}
          </div>
        )}

        {/* ── Q&A Chatbot ── */}
        {rightTab==="qa" && (
          <div style={{ flex:1,display:"flex",flexDirection:"column",minHeight:0 }}>

            {/* Q&A messages */}
            <div style={{ flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10 }}>
              {qaMessages.map(msg=>(
                <div key={msg.id} style={{ display:"flex",gap:9,flexDirection:msg.role==="user"?"row-reverse":"row",alignItems:"flex-start" }}>
                  <div style={{ width:26,height:26,borderRadius:"50%",flexShrink:0,background:msg.role==="user"?"linear-gradient(135deg,#1d4ed8,#3b82f6)":"linear-gradient(135deg,#7c3aed,#9333ea)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff" }}>
                    {msg.role==="user"?"U":"?"}
                  </div>
                  <div style={S.bubble(msg.role)}>
                    <span dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }} />
                  </div>
                </div>
              ))}
              <div ref={qaEnd} />
            </div>

            {/* Suggested questions */}
            <div style={{ padding:"8px 14px",borderTop:"1px solid #0f1929",display:"flex",flexWrap:"wrap",gap:5,flexShrink:0 }}>
              {QA_SUGGESTIONS.map(s=>(
                <button key={s} onClick={()=>handleQaInput(s)} style={{ background:"#0d1929",border:"1px solid #1a3050",borderRadius:5,padding:"4px 9px",cursor:"pointer",color:"#4a5568",fontSize:10,fontWeight:600,fontFamily:"inherit",transition:"color 0.15s" }}
                  onMouseEnter={e=>e.target.style.color="#7dd3fc"} onMouseLeave={e=>e.target.style.color="#4a5568"}>
                  {s}
                </button>
              ))}
            </div>

            {/* Q&A input */}
            <div style={S.inp}>
              <div style={S.inpBox}>
                <textarea ref={qaArea} value={qaInput} onChange={e=>{setQaInput(e.target.value);qaAutoResize();}}
                  onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleQaInput(qaInput);}}}
                  placeholder="Ask about the generated project or ThingWorx concepts…"
                  rows={1}
                  style={{ flex:1,background:"transparent",border:"none",outline:"none",color:"#e2e8f0",fontSize:12,resize:"none",lineHeight:1.5,fontFamily:"inherit",maxHeight:100 }}
                />
                <button onClick={()=>handleQaInput(qaInput)} disabled={!qaInput.trim()} style={S.btn(!!qaInput.trim())}>→</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1a2540;border-radius:3px}
        *{box-sizing:border-box}
      `}</style>
    </div>
  );
}
