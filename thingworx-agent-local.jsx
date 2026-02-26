import { useState, useRef, useEffect } from "react";

// ════════════════════════════════════════════════════════════════════
//  THINGWORX LOCAL XML GENERATION ENGINE
//  No API. No cost. 100% browser-side rule-based generation.
// ════════════════════════════════════════════════════════════════════

// ── Utility helpers ──────────────────────────────────────────────────
function toCamel(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase());
}
function toProjectName(str) {
  return str.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(".");
}
function uid() { return Math.random().toString(36).substr(2, 8); }

// ── Property type inference from keyword ────────────────────────────
function inferBaseType(name) {
  const n = name.toLowerCase();
  if (n.includes("time") || n.includes("date") || n.includes("timestamp")) return "DATETIME";
  if (n.includes("count") || n.includes("qty") || n.includes("quantity") || n.includes("number") || n.includes("num") || n.includes("id")) return "INTEGER";
  if (n.includes("temp") || n.includes("pressure") || n.includes("humidity") || n.includes("voltage") || n.includes("current") || n.includes("power") || n.includes("speed") || n.includes("flow") || n.includes("level") || n.includes("weight") || n.includes("rate") || n.includes("percent") || n.includes("oee") || n.includes("vibrat") || n.includes("ph") || n.includes("turbid")) return "NUMBER";
  if (n.includes("enabled") || n.includes("active") || n.includes("running") || n.includes("status") || n.includes("alarm") || n.includes("alert") || n.includes("online") || n.includes("connected") || n.includes("flag")) return "BOOLEAN";
  return "STRING";
}

// ── Keyword → domain parser ──────────────────────────────────────────
function parseUseCase(text) {
  const t = text.toLowerCase();

  // Detect domain
  let domain = "generic";
  if (t.includes("temperat") || t.includes("thermometer") || t.includes("heat") || t.includes("hvac")) domain = "temperature";
  else if (t.includes("cnc") || t.includes("machine") || t.includes("manufact") || t.includes("production") || t.includes("milling") || t.includes("lathe")) domain = "cnc";
  else if (t.includes("water") || t.includes("ph") || t.includes("turbid") || t.includes("quality")) domain = "water";
  else if (t.includes("energy") || t.includes("power") || t.includes("electric") || t.includes("kwh") || t.includes("voltage") || t.includes("current")) domain = "energy";
  else if (t.includes("asset") || t.includes("equipment") || t.includes("sensor") || t.includes("iot")) domain = "iot";
  else if (t.includes("vehicle") || t.includes("fleet") || t.includes("gps") || t.includes("truck") || t.includes("car")) domain = "fleet";
  else if (t.includes("warehouse") || t.includes("inventory") || t.includes("stock")) domain = "warehouse";
  else if (t.includes("pump") || t.includes("valve") || t.includes("pressure") || t.includes("flow")) domain = "pump";

  // Detect features
  const hasAlerts    = t.includes("alert") || t.includes("alarm") || t.includes("notif") || t.includes("threshold");
  const hasHistory   = t.includes("histor") || t.includes("trend") || t.includes("time-series") || t.includes("timeseries") || t.includes("log");
  const hasDashboard = t.includes("dashboard") || t.includes("visual") || t.includes("display") || t.includes("chart") || t.includes("monitor") || t.includes("mashup");
  const hasScheduler = t.includes("schedul") || t.includes("periodic") || t.includes("cron") || t.includes("interval");
  const hasDB        = t.includes("database") || t.includes("persist") || t.includes("store") || t.includes("datatable");

  // Extract project name from text
  const words = text.split(/\s+/).filter(w => w.length > 3 && !["with","that","this","from","into","have","will","should","build","create","make","generate","need","want","for","and","the","dashboard"].includes(w.toLowerCase()));
  const projectBase = words.slice(0, 3).join(" ") || "MyProject";

  return { domain, hasAlerts, hasHistory, hasDashboard, hasScheduler, hasDB, projectBase, raw: text };
}

// ── Domain property definitions ──────────────────────────────────────
const DOMAIN_PROPS = {
  temperature: [
    { name: "temperature",    baseType: "NUMBER",   description: "Current temperature reading in °C", persistent: true,  logged: true  },
    { name: "humidity",       baseType: "NUMBER",   description: "Relative humidity percentage",      persistent: true,  logged: true  },
    { name: "setpoint",       baseType: "NUMBER",   description: "Target temperature setpoint",       persistent: true,  logged: false },
    { name: "unit",           baseType: "STRING",   description: "Temperature unit (C or F)",         persistent: true,  logged: false },
    { name: "sensorStatus",   baseType: "STRING",   description: "Sensor connection status",          persistent: false, logged: false },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Timestamp of last reading",         persistent: true,  logged: false },
    { name: "location",       baseType: "STRING",   description: "Physical location of sensor",       persistent: true,  logged: false },
    { name: "isOverThreshold",baseType: "BOOLEAN",  description: "High temperature alarm flag",       persistent: false, logged: false },
  ],
  cnc: [
    { name: "spindleSpeed",   baseType: "NUMBER",   description: "Spindle RPM",                  persistent: true, logged: true  },
    { name: "feedRate",       baseType: "NUMBER",   description: "Feed rate mm/min",              persistent: true, logged: true  },
    { name: "machineStatus",  baseType: "STRING",   description: "Current machine status",        persistent: true, logged: true  },
    { name: "programNumber",  baseType: "STRING",   description: "Active CNC program number",     persistent: true, logged: false },
    { name: "operatingHours", baseType: "NUMBER",   description: "Total machine operating hours", persistent: true, logged: true  },
    { name: "toolNumber",     baseType: "INTEGER",  description: "Active tool station number",    persistent: true, logged: false },
    { name: "alarmCode",      baseType: "STRING",   description: "Active alarm code if any",      persistent: true, logged: true  },
    { name: "isRunning",      baseType: "BOOLEAN",  description: "Machine running state",         persistent: false,logged: false },
    { name: "partCount",      baseType: "INTEGER",  description: "Parts produced counter",        persistent: true, logged: true  },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Timestamp of last update",      persistent: true, logged: false },
  ],
  water: [
    { name: "phLevel",        baseType: "NUMBER",   description: "pH level 0-14",                  persistent: true, logged: true },
    { name: "turbidity",      baseType: "NUMBER",   description: "Turbidity in NTU",               persistent: true, logged: true },
    { name: "dissolvedO2",    baseType: "NUMBER",   description: "Dissolved oxygen mg/L",          persistent: true, logged: true },
    { name: "conductivity",   baseType: "NUMBER",   description: "Electrical conductivity µS/cm",  persistent: true, logged: true },
    { name: "waterTemp",      baseType: "NUMBER",   description: "Water temperature °C",           persistent: true, logged: true },
    { name: "flowRate",       baseType: "NUMBER",   description: "Flow rate L/min",                persistent: true, logged: true },
    { name: "sensorStatus",   baseType: "STRING",   description: "Sensor status",                  persistent: true, logged: false },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Last reading timestamp",         persistent: true, logged: false },
  ],
  energy: [
    { name: "activePower",    baseType: "NUMBER",   description: "Active power in kW",            persistent: true, logged: true },
    { name: "voltage",        baseType: "NUMBER",   description: "Voltage in V",                  persistent: true, logged: true },
    { name: "current",        baseType: "NUMBER",   description: "Current in A",                  persistent: true, logged: true },
    { name: "powerFactor",    baseType: "NUMBER",   description: "Power factor 0-1",              persistent: true, logged: true },
    { name: "energyTotal",    baseType: "NUMBER",   description: "Total energy consumed kWh",     persistent: true, logged: true },
    { name: "frequency",      baseType: "NUMBER",   description: "Grid frequency Hz",             persistent: true, logged: true },
    { name: "meterStatus",    baseType: "STRING",   description: "Meter status",                  persistent: true, logged: false },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Last reading timestamp",        persistent: true, logged: false },
  ],
  fleet: [
    { name: "latitude",       baseType: "NUMBER",   description: "GPS latitude",                  persistent: true, logged: true },
    { name: "longitude",      baseType: "NUMBER",   description: "GPS longitude",                 persistent: true, logged: true },
    { name: "speed",          baseType: "NUMBER",   description: "Vehicle speed km/h",            persistent: true, logged: true },
    { name: "engineStatus",   baseType: "STRING",   description: "Engine on/off status",          persistent: true, logged: true },
    { name: "fuelLevel",      baseType: "NUMBER",   description: "Fuel level percentage",         persistent: true, logged: true },
    { name: "odometer",       baseType: "NUMBER",   description: "Odometer reading km",           persistent: true, logged: true },
    { name: "driverId",       baseType: "STRING",   description: "Assigned driver ID",            persistent: true, logged: false },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Last GPS update timestamp",     persistent: true, logged: false },
  ],
  pump: [
    { name: "flowRate",       baseType: "NUMBER",   description: "Flow rate m³/h",               persistent: true, logged: true },
    { name: "pressure",       baseType: "NUMBER",   description: "Discharge pressure bar",        persistent: true, logged: true },
    { name: "motorCurrent",   baseType: "NUMBER",   description: "Motor current A",               persistent: true, logged: true },
    { name: "runningHours",   baseType: "NUMBER",   description: "Total running hours",           persistent: true, logged: true },
    { name: "pumpStatus",     baseType: "STRING",   description: "Pump running status",           persistent: true, logged: true },
    { name: "vibration",      baseType: "NUMBER",   description: "Vibration level mm/s",          persistent: true, logged: true },
    { name: "isRunning",      baseType: "BOOLEAN",  description: "Pump on/off state",             persistent: false,logged: false },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Last update timestamp",         persistent: true, logged: false },
  ],
  warehouse: [
    { name: "stockLevel",     baseType: "INTEGER",  description: "Current stock quantity",        persistent: true, logged: true },
    { name: "temperature",    baseType: "NUMBER",   description: "Storage temperature °C",        persistent: true, logged: true },
    { name: "humidity",       baseType: "NUMBER",   description: "Storage humidity %",            persistent: true, logged: true },
    { name: "zoneId",         baseType: "STRING",   description: "Warehouse zone identifier",     persistent: true, logged: false },
    { name: "lastMovement",   baseType: "DATETIME", description: "Last stock movement timestamp", persistent: true, logged: false },
    { name: "doorStatus",     baseType: "STRING",   description: "Door open/closed status",       persistent: true, logged: true },
    { name: "isOccupied",     baseType: "BOOLEAN",  description: "Zone occupied flag",            persistent: false,logged: false },
  ],
  iot: [
    { name: "sensorValue",    baseType: "NUMBER",   description: "Primary sensor reading",        persistent: true, logged: true  },
    { name: "sensorStatus",   baseType: "STRING",   description: "Sensor connection status",      persistent: true, logged: false },
    { name: "batteryLevel",   baseType: "NUMBER",   description: "Battery level percentage",      persistent: true, logged: true  },
    { name: "signalStrength", baseType: "NUMBER",   description: "RF signal strength dBm",        persistent: true, logged: true  },
    { name: "isOnline",       baseType: "BOOLEAN",  description: "Device online flag",            persistent: false,logged: false },
    { name: "firmwareVersion",baseType: "STRING",   description: "Device firmware version",       persistent: true, logged: false },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Last communication timestamp",  persistent: true, logged: false },
  ],
  generic: [
    { name: "value",          baseType: "NUMBER",   description: "Primary measured value",        persistent: true, logged: true  },
    { name: "status",         baseType: "STRING",   description: "Entity status",                 persistent: true, logged: false },
    { name: "description",    baseType: "STRING",   description: "Free text description",         persistent: true, logged: false },
    { name: "isActive",       baseType: "BOOLEAN",  description: "Active/inactive flag",          persistent: false,logged: false },
    { name: "lastUpdated",    baseType: "DATETIME", description: "Last update timestamp",         persistent: true, logged: false },
  ],
};

// ── Alert thresholds by domain ────────────────────────────────────────
const DOMAIN_ALERTS = {
  temperature: [{ prop: "temperature", type: "Above", limit: "80", name: "HighTempAlert", priority: "high" },
                { prop: "temperature", type: "Below", limit: "-10", name: "LowTempAlert", priority: "medium" }],
  cnc:         [{ prop: "spindleSpeed", type: "Above", limit: "12000", name: "OverSpeedAlert", priority: "high" },
                { prop: "operatingHours", type: "Above", limit: "500", name: "MaintenanceDueAlert", priority: "medium" }],
  water:       [{ prop: "phLevel", type: "Above", limit: "8.5", name: "HighPhAlert", priority: "high" },
                { prop: "phLevel", type: "Below", limit: "6.5", name: "LowPhAlert", priority: "high" },
                { prop: "turbidity", type: "Above", limit: "10", name: "HighTurbidityAlert", priority: "medium" }],
  energy:      [{ prop: "activePower", type: "Above", limit: "1000", name: "OverloadAlert", priority: "high" },
                { prop: "powerFactor", type: "Below", limit: "0.85", name: "LowPFAlert", priority: "medium" }],
  pump:        [{ prop: "pressure", type: "Above", limit: "10", name: "HighPressureAlert", priority: "high" },
                { prop: "vibration", type: "Above", limit: "7", name: "HighVibrationAlert", priority: "high" }],
  fleet:       [{ prop: "speed", type: "Above", limit: "120", name: "OverSpeedAlert", priority: "high" },
                { prop: "fuelLevel", type: "Below", limit: "15", name: "LowFuelAlert", priority: "medium" }],
  warehouse:   [{ prop: "temperature", type: "Above", limit: "25", name: "HighTempAlert", priority: "medium" },
                { prop: "stockLevel", type: "Below", limit: "10", name: "LowStockAlert", priority: "medium" }],
  iot:         [{ prop: "sensorValue", type: "Above", limit: "90", name: "HighValueAlert", priority: "medium" },
                { prop: "batteryLevel", type: "Below", limit: "20", name: "LowBatteryAlert", priority: "medium" }],
  generic:     [{ prop: "value", type: "Above", limit: "100", name: "ThresholdAlert", priority: "medium" }],
};

// ════════════════════════════════════════════════════════════════════
//  XML GENERATORS
// ════════════════════════════════════════════════════════════════════

function genProject(ctx) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Entities
 majorVersion="9"
 minorVersion="5"
 universal="password">
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
         packageVersion="1.0.0"
         projectName="${ctx.projectName}"
         publishResult=""
         state="DRAFT"
         tags="">
            <avatar></avatar>
            <DesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions>
                <Visibility></Visibility>
            </VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables></ConfigurationTables>
        </Project>
    </Projects>
</Entities>`;
}

function genDataShape(ctx) {
  const fields = ctx.props.map((p, i) => `            <FieldDefinition
             aspect.isPrimaryKey="${p.name === "id" ? "true" : "false"}"
             baseType="${p.baseType}"
             description="${p.description}"
             name="${p.name}"
             ordinal="${i + 1}"></FieldDefinition>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Entities
 majorVersion="9"
 minorVersion="5"
 universal="password">
    <DataShapes>
        <DataShape
         aspect.isExtension="true"
         baseDataShape=""
         description="DataShape for ${ctx.label} data structure"
         documentationContent=""
         homeMashup=""
         name="${ctx.dsName}"
         projectName="${ctx.projectName}"
         tags="">
            <avatar></avatar>
            <DesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions>
                <Visibility></Visibility>
            </VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables></ConfigurationTables>
            <FieldDefinitions>
${fields}
            </FieldDefinitions>
        </DataShape>
    </DataShapes>
</Entities>`;
}

function genValueStream(ctx) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Entities
 majorVersion="9"
 minorVersion="5"
 universal="password">
    <Things>
        <Thing
         aspect.isExtension="true"
         description="ValueStream for ${ctx.label} time-series data persistence (PostgreSQL)"
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
            <DesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions>
                <Visibility></Visibility>
            </VisibilityPermissions>
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
                            <FieldDefinition
                             baseType="THINGNAME"
                             description="Persistence provider package"
                             name="persistenceProviderPackageName"
                             ordinal="0"></FieldDefinition>
                        </FieldDefinitions>
                    </DataShape>
                    <Rows>
                        <Row>
                            <persistenceProviderPackageName>
                            <![CDATA[
                            PostgreSQLPersistenceProviderPackage
                            ]]>
                            </persistenceProviderPackageName>
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
</Entities>`;
}

function genThingTemplate(ctx) {
  const propDefs = ctx.props.map((p, i) => `                    <PropertyDefinition
                     aspect.cacheTime="0.0"
                     aspect.dataChangeType="VALUE"
                     aspect.isPersistent="${p.persistent ? "true" : "false"}"
                     aspect.isLogged="${p.logged ? "true" : "false"}"
                     baseType="${p.baseType}"
                     category=""
                     description="${p.description}"
                     isLocalOnly="false"
                     name="${p.name}"
                     ordinal="${i + 1}"></PropertyDefinition>`).join("\n");

  // Service: GetCurrentData
  const returnFields = ctx.props.map(p => `                                            <FieldDefinition
                                             baseType="${p.baseType}"
                                             description="${p.description}"
                                             name="${p.name}"
                                             ordinal="0"></FieldDefinition>`).join("\n");

  // Service: GetHistoricalData
  const queryHistoryScript = ctx.hasHistory ? `
                    <ServiceDefinition
                     aspect.isAsync="false"
                     category=""
                     description="Query historical data from ValueStream"
                     isAllowOverride="false"
                     isLocalOnly="false"
                     isOpen="false"
                     isPrivate="false"
                     name="GetHistoricalData">
                        <ResultType
                         baseType="INFOTABLE"
                         description="Historical data result"
                         name="result"
                         ordinal="0">
                            <Aspects>
                                <Aspect name="dataShape" value="${ctx.dsName}"></Aspect>
                            </Aspects>
                        </ResultType>
                        <ParameterDefinitions>
                            <FieldDefinition
                             baseType="DATETIME"
                             description="Start time for query"
                             name="startDate"
                             ordinal="1"></FieldDefinition>
                            <FieldDefinition
                             baseType="DATETIME"
                             description="End time for query"
                             name="endDate"
                             ordinal="2"></FieldDefinition>
                            <FieldDefinition
                             baseType="INTEGER"
                             description="Maximum number of rows"
                             name="maxItems"
                             ordinal="3"></FieldDefinition>
                        </ParameterDefinitions>
                    </ServiceDefinition>` : "";

  const alertServiceDef = ctx.hasAlerts ? `
                    <ServiceDefinition
                     aspect.isAsync="false"
                     category=""
                     description="Check thresholds and fire alerts"
                     isAllowOverride="false"
                     isLocalOnly="false"
                     isOpen="false"
                     isPrivate="false"
                     name="CheckAlertThresholds">
                        <ResultType
                         baseType="NOTHING"
                         description=""
                         name="result"
                         ordinal="0"></ResultType>
                        <ParameterDefinitions></ParameterDefinitions>
                    </ServiceDefinition>` : "";

  const queryHistoryImpl = ctx.hasHistory ? `
                    <ServiceImplementation
                     description=""
                     handlerName="Script"
                     name="GetHistoricalData">
                        <ConfigurationTables>
                            <ConfigurationTable
                             dataShapeName=""
                             description=""
                             isMultiRow="false"
                             name="Script"
                             ordinal="0">
                                <DataShape>
                                    <FieldDefinitions>
                                        <FieldDefinition
                                         baseType="STRING"
                                         description="code"
                                         name="code"
                                         ordinal="0"></FieldDefinition>
                                    </FieldDefinitions>
                                </DataShape>
                                <Rows>
                                    <Row>
                                        <code>
                                        <![CDATA[
                                        /*
                                         * @name GetHistoricalData
                                         * @description Query historical data from ValueStream
                                         * @param startDate - Start datetime for the query
                                         * @param endDate   - End datetime for the query
                                         * @param maxItems  - Max number of rows to return
                                         * @return INFOTABLE with historical property values
                                         */
                                        var params = {
                                            startDate  : startDate,
                                            endDate    : endDate,
                                            maxItems   : maxItems || 500,
                                            propertyNames: new Array("${ctx.props.filter(p => p.logged).map(p => p.name).join('","')}")
                                        };
                                        var result = me.QueryPropertyHistory(params);
                                        ]]>
                                        </code>
                                    </Row>
                                </Rows>
                            </ConfigurationTable>
                        </ConfigurationTables>
                    </ServiceImplementation>` : "";

  const alertImpl = ctx.hasAlerts ? `
                    <ServiceImplementation
                     description=""
                     handlerName="Script"
                     name="CheckAlertThresholds">
                        <ConfigurationTables>
                            <ConfigurationTable
                             dataShapeName=""
                             description=""
                             isMultiRow="false"
                             name="Script"
                             ordinal="0">
                                <DataShape>
                                    <FieldDefinitions>
                                        <FieldDefinition
                                         baseType="STRING"
                                         description="code"
                                         name="code"
                                         ordinal="0"></FieldDefinition>
                                    </FieldDefinitions>
                                </DataShape>
                                <Rows>
                                    <Row>
                                        <code>
                                        <![CDATA[
                                        /*
                                         * @name CheckAlertThresholds
                                         * @description Evaluate alert conditions and log active alerts
                                         */
                                        var activeAlerts = me.GetAlertSummary({ maxItems: 100, filter: undefined });
                                        if (activeAlerts && activeAlerts.rows.length > 0) {
                                            logger.warn("[" + me.name + "] Active alerts: " + activeAlerts.rows.length);
                                            activeAlerts.rows.toArray().forEach(function(row) {
                                                logger.warn("[" + me.name + "] Alert: " + row.name + " | Property: " + row.property + " | Priority: " + row.priority);
                                            });
                                        }
                                        ]]>
                                        </code>
                                    </Row>
                                </Rows>
                            </ConfigurationTable>
                        </ConfigurationTables>
                    </ServiceImplementation>` : "";

  // Alert configurations on properties
  const alertConfigs = ctx.hasAlerts && ctx.alerts.length > 0
    ? ctx.props.map(p => {
        const propAlerts = ctx.alerts.filter(a => a.prop === p.name);
        if (!propAlerts.length) return `                <AlertDefinitions name="${p.name}"></AlertDefinitions>`;
        const alertXml = propAlerts.map(a => `                    <Alert
                     description="${a.name} triggered"
                     enabled="true"
                     name="${a.name}"
                     priority="${a.priority}"
                     type="${a.type}">
                        <Attributes>
                            <limit>${a.limit}</limit>
                        </Attributes>
                    </Alert>`).join("\n");
        return `                <AlertDefinitions name="${p.name}">\n${alertXml}\n                </AlertDefinitions>`;
      }).join("\n")
    : ctx.props.map(p => `                <AlertDefinitions name="${p.name}"></AlertDefinitions>`).join("\n");

  // DataChange subscription to update lastUpdated
  const subscription = `
                    <Subscription
                     description="Log data changes to ValueStream"
                     enabled="true"
                     eventName="DataChange"
                     name="OnDataChange"
                     source=""
                     sourceProperty="${ctx.props[0]?.name || "value"}"
                     sourceType="Thing">
                        <ServiceImplementation
                         description=""
                         handlerName="Script"
                         name="OnDataChange">
                            <ConfigurationTables>
                                <ConfigurationTable
                                 dataShapeName=""
                                 description=""
                                 isMultiRow="false"
                                 name="Script"
                                 ordinal="0">
                                    <DataShape>
                                        <FieldDefinitions>
                                            <FieldDefinition
                                             baseType="STRING"
                                             description="code"
                                             name="code"
                                             ordinal="0"></FieldDefinition>
                                        </FieldDefinitions>
                                    </DataShape>
                                    <Rows>
                                        <Row>
                                            <code>
                                            <![CDATA[
                                            /*
                                             * @name OnDataChange
                                             * @description Triggered on property data change - updates lastUpdated timestamp
                                             */
                                            logger.info("[" + me.name + "] DataChange event - property: " + eventData.propertyName + " | value: " + eventData.value);
                                            ${ctx.props.some(p => p.name === "lastUpdated") ? "me.lastUpdated = new Date();" : ""}
                                            ]]>
                                            </code>
                                        </Row>
                                    </Rows>
                                </ConfigurationTable>
                            </ConfigurationTables>
                        </ServiceImplementation>
                    </Subscription>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Entities
 majorVersion="9"
 minorVersion="5"
 universal="password">
    <ThingTemplates>
        <ThingTemplate
         aspect.isExtension="true"
         baseThingTemplate="GenericThing"
         description="ThingTemplate for ${ctx.label} - defines properties, services and alerts"
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
            <DesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions>
                <Visibility></Visibility>
            </VisibilityPermissions>
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
                <ServiceDefinitions>${queryHistoryScript}${alertServiceDef}
                </ServiceDefinitions>
                <EventDefinitions></EventDefinitions>
                <ServiceMappings></ServiceMappings>
                <ServiceImplementations>${queryHistoryImpl}${alertImpl}
                </ServiceImplementations>
                <Subscriptions>${subscription}
                </Subscriptions>
            </ThingShape>
            <ImplementedShapes></ImplementedShapes>
            <SharedConfigurationTables></SharedConfigurationTables>
            <InstanceDesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </InstanceDesignTimePermissions>
            <InstanceRunTimePermissions></InstanceRunTimePermissions>
            <InstanceVisibilityPermissions>
                <Visibility></Visibility>
            </InstanceVisibilityPermissions>
        </ThingTemplate>
    </ThingTemplates>
</Entities>`;
}

function genThing(ctx) {
  const thingPropsXml = ctx.props.map(p => {
    let defaultVal = "";
    if (p.baseType === "NUMBER") defaultVal = "0.0";
    else if (p.baseType === "INTEGER") defaultVal = "0";
    else if (p.baseType === "BOOLEAN") defaultVal = "false";
    else if (p.baseType === "DATETIME") defaultVal = "1970-01-01T00:00:00.000Z";
    else defaultVal = "";
    return `                <${p.name}>
                    <Value><![CDATA[${defaultVal}]]></Value>
                    <Timestamp>1970-01-01T00:00:00.000Z</Timestamp>
                    <Quality>UNKNOWN</Quality>
                </${p.name}>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Entities
 majorVersion="9"
 minorVersion="5"
 universal="password">
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
            <DesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </DesignTimePermissions>
            <RunTimePermissions>
                <Permissions
                 resourceName="*">
                    <PropertyRead>
                        <Principal
                         isPermitted="true"
                         name="Users"
                         type="Group"></Principal>
                    </PropertyRead>
                    <PropertyWrite>
                        <Principal
                         isPermitted="true"
                         name="Users"
                         type="Group"></Principal>
                    </PropertyWrite>
                    <ServiceInvoke>
                        <Principal
                         isPermitted="true"
                         name="Users"
                         type="Group"></Principal>
                    </ServiceInvoke>
                    <EventInvoke></EventInvoke>
                    <EventSubscribe></EventSubscribe>
                </Permissions>
            </RunTimePermissions>
            <VisibilityPermissions>
                <Visibility></Visibility>
            </VisibilityPermissions>
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
${thingPropsXml}
            </ThingProperties>
        </Thing>
    </Things>
</Entities>`;
}

function genMashup(ctx) {
  // Build data services
  const services = [
    { id: uid(), name: "GetProperties", api: "get", target: "GetProperties", refresh: 10 },
  ];
  if (ctx.hasHistory) services.push({ id: uid(), name: "GetHistoricalData", api: "post", target: "GetHistoricalData", refresh: 0 });

  const dataServicesJson = services.map(s => `    {
      "APIMethod": "${s.api}",
      "Characteristic": "Services",
      "Id": "${s.id}",
      "Name": "${s.name}",
      "Parameters": {},
      "RefreshInterval": ${s.refresh},
      "Target": "${s.target}"
    }`).join(",\n");

  // Build numeric property widgets (gauges + value displays)
  const numericProps = ctx.props.filter(p => p.baseType === "NUMBER" || p.baseType === "INTEGER").slice(0, 6);
  const widgetList = numericProps.map((p, i) => ({
    id: `ptcsvaluedisplay-${100 + i}`,
    label: p.name.replace(/([A-Z])/g, " $1").trim(),
    prop: p.name,
  }));

  const widgetJsonArr = widgetList.map(w => `          {
            "Properties": {
              "Area": "UI",
              "DisplayName": "${w.label}",
              "Id": "${w.id}",
              "Label": "${w.label}",
              "LabelAlignment": "left",
              "LastContainer": false,
              "Margin": "8",
              "ShowDataLoading": true,
              "Type": "ptcsvaluedisplay",
              "UseTheme": true,
              "Visible": true,
              "Z-index": 10,
              "__TypeDisplayName": "Value Display"
            },
            "Widgets": []
          }`).join(",\n");

  // DataBindings: wire GetProperties → value displays
  const dataBindings = widgetList.map(w => ({
    id: uid(),
    sourceId: "GetProperties",
    targetId: w.id,
    sourceProp: w.prop,
    targetProp: "Value",
    baseType: "NUMBER",
  })).map(b => `    {
      "Id": "${b.id}",
      "PropertyMaps": [{
        "SourceProperty": "${b.sourceProp}",
        "SourcePropertyBaseType": "NUMBER",
        "SourcePropertyType": "Property",
        "TargetProperty": "${b.targetProp}",
        "TargetPropertyBaseType": "NUMBER",
        "TargetPropertyType": "property"
      }],
      "SourceArea": "Data",
      "SourceDetails": "AllData",
      "SourceId": "GetProperties",
      "SourceSection": "Things_${ctx.thingName}",
      "TargetArea": "UI",
      "TargetId": "${b.targetId}",
      "TargetSection": ""
    }`).join(",\n");

  const mashupContent = `{
  "CustomMashupCss": "",
  "Data": {
    "Things_${ctx.thingName}": {
      "DataName": "Things_${ctx.thingName}",
      "EntityName": "${ctx.thingName}",
      "EntityType": "Things",
      "Id": "${uid()}",
      "RefreshInterval": 10,
      "Services": [
${dataServicesJson}
      ]
    }
  },
  "DataBindings": [
${dataBindings}
  ],
  "Events": [
    {
      "EventHandlerArea": "Data",
      "EventHandlerId": "Things_${ctx.thingName}",
      "EventHandlerService": "GetProperties",
      "EventTriggerArea": "Mashup",
      "EventTriggerEvent": "Loaded",
      "EventTriggerId": "mashup-root",
      "EventTriggerSection": "",
      "Id": "${uid()}"
    }
  ],
  "UI": {
    "Properties": {
      "AddToDashboardButton": "SimplePlus",
      "Area": "Mashup",
      "Columns": 0,
      "DisplayName": "Mashup",
      "Height": 768,
      "Id": "mashup-root",
      "MashupResolution": "FHD 1920x1080",
      "ResponsiveLayout": true,
      "Rows": 0,
      "ShowDataLoading": true,
      "Style": "DefaultMashupStyle",
      "Title": "${ctx.label} Dashboard",
      "TitleBar": true,
      "TitleBarText": "${ctx.label} Dashboard",
      "Top": 0,
      "Type": "mashup",
      "UseMasterTheme": false,
      "UseTheme": true,
      "Visible": true,
      "Width": 1920,
      "Z-index": 10,
      "__TypeDisplayName": "Mashup",
      "id_index": 200,
      "supportsAutoResize": true
    },
    "Widgets": [
      {
        "Properties": {
          "Area": "UI",
          "DisplayName": "main-container",
          "EnableExpandCollapse": false,
          "Expanded": true,
          "Id": "flexcontainer-1",
          "LastContainer": true,
          "Overlay": false,
          "ResponsiveLayout": true,
          "ShowDataLoading": true,
          "Style": "DefaultContainerStyle",
          "Type": "flexcontainer",
          "UseTheme": true,
          "Visible": true,
          "Z-index": 10,
          "__TypeDisplayName": "Responsive Container",
          "align-content": "flex-start",
          "align-items": "flex-start",
          "flex-direction": "column",
          "flex-grow": 1,
          "flex-wrap": "wrap",
          "justify-content": "flex-start",
          "positioning": "responsive",
          "userCannotRemove": true
        },
        "Widgets": [
          {
            "Properties": {
              "Area": "UI",
              "DisplayName": "dashboard-title",
              "Id": "ptcslabel-title",
              "LabelText": "${ctx.label} Dashboard",
              "LabelType": "sub-header",
              "Margin": "10",
              "ShowDataLoading": true,
              "Type": "ptcslabel",
              "UseTheme": true,
              "Visible": true,
              "Z-index": 10,
              "__TypeDisplayName": "Label"
            },
            "Widgets": []
          },
          {
            "Properties": {
              "Area": "UI",
              "DisplayName": "kpi-container",
              "Id": "flexcontainer-kpi",
              "LastContainer": false,
              "ResponsiveLayout": true,
              "ShowDataLoading": true,
              "Style": "DefaultContainerStyle",
              "Type": "flexcontainer",
              "UseTheme": true,
              "Visible": true,
              "Z-index": 10,
              "__TypeDisplayName": "Responsive Container",
              "align-content": "flex-start",
              "align-items": "center",
              "flex-direction": "row",
              "flex-grow": 1,
              "flex-wrap": "wrap",
              "justify-content": "flex-start",
              "positioning": "responsive"
            },
            "Widgets": [
${widgetJsonArr}
            ]
          }${ctx.hasHistory ? `,
          {
            "Properties": {
              "Area": "UI",
              "DisplayName": "trend-chart",
              "Id": "ptcschart-trend",
              "Margin": "10",
              "ShowDataLoading": true,
              "Type": "ptcschart",
              "UseTheme": true,
              "Visible": true,
              "Z-index": 10,
              "__TypeDisplayName": "Chart",
              "ChartType": "line",
              "XAxisField": "timestamp",
              "YAxisField": "${numericProps[0]?.name || "value"}"
            },
            "Widgets": []
          }` : ""}
        ]
      }
    ]
  },
  "mashupType": "mashup"
}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Entities
 majorVersion="9"
 minorVersion="5"
 universal="password">
    <Mashups>
        <Mashup
         aspect.isExtension="true"
         aspect.isFlex="true"
         aspect.isResponsive="true"
         aspect.mashupType="mashup"
         columns="0.0"
         description="${ctx.label} Dashboard - real-time monitoring and visualization"
         documentationContent=""
         homeMashup=""
         name="${ctx.muName}"
         projectName="${ctx.projectName}"
         rows="0.0"
         tags="">
            <avatar></avatar>
            <DesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions>
                <Visibility></Visibility>
            </VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables>
                <ConfigurationTable
                 dataShapeName=""
                 description="Mashup Mobile Settings"
                 isHidden="true"
                 isMultiRow="false"
                 name="MobileSettings"
                 ordinal="0">
                    <DataShape>
                        <FieldDefinitions>
                            <FieldDefinition aspect.defaultValue="false" aspect.friendlyName="Disable Zoom" baseType="BOOLEAN" description="Disables zooming" name="disableZoom" ordinal="0"></FieldDefinition>
                            <FieldDefinition aspect.defaultValue="true" aspect.friendlyName="Full Screen Mode" baseType="BOOLEAN" description="Full screen mode" name="fullScreenMode" ordinal="0"></FieldDefinition>
                            <FieldDefinition aspect.defaultValue="1.0" aspect.friendlyName="Initial Scale" baseType="NUMBER" description="Initial zoom scale" name="initialScale" ordinal="0"></FieldDefinition>
                        </FieldDefinitions>
                    </DataShape>
                    <Rows>
                        <Row>
                            <disableZoom>false</disableZoom>
                            <fullScreenMode>true</fullScreenMode>
                            <initialScale>1.0</initialScale>
                        </Row>
                    </Rows>
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
</Entities>`;
}

function genScheduler(ctx) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Entities
 majorVersion="9"
 minorVersion="5"
 universal="password">
    <Things>
        <Thing
         aspect.isExtension="true"
         description="Scheduled task for ${ctx.label} periodic data processing"
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
            <DesignTimePermissions>
                <Create></Create>
                <Read></Read>
                <Update></Update>
                <Delete></Delete>
                <Metadata></Metadata>
            </DesignTimePermissions>
            <RunTimePermissions></RunTimePermissions>
            <VisibilityPermissions>
                <Visibility></Visibility>
            </VisibilityPermissions>
            <ConfigurationTableDefinitions></ConfigurationTableDefinitions>
            <ConfigurationTables>
                <ConfigurationTable
                 dataShapeName=""
                 description="General Settings"
                 isHidden="true"
                 isMultiRow="false"
                 name="Settings"
                 ordinal="0">
                    <DataShape>
                        <FieldDefinitions>
                            <FieldDefinition
                             aspect.defaultValue="true"
                             baseType="BOOLEAN"
                             description="Automatically enable scheduler on startup"
                             name="enabled"
                             ordinal="0"></FieldDefinition>
                            <FieldDefinition
                             baseType="USERNAME"
                             description="User context in which to run event handlers"
                             name="runAsUser"
                             ordinal="0"></FieldDefinition>
                            <FieldDefinition
                             aspect.defaultValue="0 0/5 * * * ?"
                             baseType="SCHEDULE"
                             description="Execution Schedule (Cron String)"
                             name="schedule"
                             ordinal="0"></FieldDefinition>
                        </FieldDefinitions>
                    </DataShape>
                    <Rows>
                        <Row>
                            <enabled>true</enabled>
                            <runAsUser><![CDATA[Administrator]]></runAsUser>
                            <schedule><![CDATA[0 0/5 * * * ?]]></schedule>
                        </Row>
                    </Rows>
                </ConfigurationTable>
            </ConfigurationTables>
            <ThingShape>
                <PropertyDefinitions></PropertyDefinitions>
                <ServiceDefinitions>
                    <ServiceDefinition
                     aspect.isAsync="false"
                     category=""
                     description="Periodic task executed on schedule"
                     isAllowOverride="false"
                     isLocalOnly="false"
                     isOpen="false"
                     isPrivate="false"
                     name="RunPeriodicTask">
                        <ResultType
                         baseType="NOTHING"
                         description=""
                         name="result"
                         ordinal="0"></ResultType>
                        <ParameterDefinitions></ParameterDefinitions>
                    </ServiceDefinition>
                </ServiceDefinitions>
                <EventDefinitions></EventDefinitions>
                <ServiceMappings></ServiceMappings>
                <ServiceImplementations>
                    <ServiceImplementation
                     description=""
                     handlerName="Script"
                     name="RunPeriodicTask">
                        <ConfigurationTables>
                            <ConfigurationTable
                             dataShapeName=""
                             description=""
                             isMultiRow="false"
                             name="Script"
                             ordinal="0">
                                <DataShape>
                                    <FieldDefinitions>
                                        <FieldDefinition
                                         baseType="STRING"
                                         description="code"
                                         name="code"
                                         ordinal="0"></FieldDefinition>
                                    </FieldDefinitions>
                                </DataShape>
                                <Rows>
                                    <Row>
                                        <code>
                                        <![CDATA[
                                        /*
                                         * @name RunPeriodicTask
                                         * @description Periodic scheduled task for ${ctx.label}
                                         *              Runs every 5 minutes via cron: 0 0/5 * * * ?
                                         */
                                        logger.info("[${ctx.schedulerName}] Periodic task started at " + new Date());
                                        
                                        try {
                                            // Get all ${ctx.label} Things implementing ${ctx.ttName}
                                            var allThings = ThingTemplates["${ctx.ttName}"].QueryImplementingThingsWithData({});
                                            
                                            allThings.rows.toArray().forEach(function(row) {
                                                var thingName = row.name;
                                                var thing = Things[thingName];
                                                
                                                logger.info("[${ctx.schedulerName}] Processing: " + thingName);
                                                
                                                // Check alerts if enabled
                                                if (thing.CheckAlertThresholds) {
                                                    thing.CheckAlertThresholds();
                                                }
                                            });
                                            
                                            logger.info("[${ctx.schedulerName}] Periodic task completed. Processed " + allThings.rows.length + " thing(s).");
                                        } catch(e) {
                                            logger.error("[${ctx.schedulerName}] Error in periodic task: " + e.message);
                                        }
                                        ]]>
                                        </code>
                                    </Row>
                                </Rows>
                            </ConfigurationTable>
                        </ConfigurationTables>
                    </ServiceImplementation>
                </ServiceImplementations>
                <Subscriptions>
                    <Subscription
                     description="Triggered on each scheduled interval"
                     enabled="true"
                     eventName="ScheduledEvent"
                     name="OnScheduledEvent"
                     source=""
                     sourceProperty=""
                     sourceType="Thing">
                        <ServiceImplementation
                         description=""
                         handlerName="Script"
                         name="OnScheduledEvent">
                            <ConfigurationTables>
                                <ConfigurationTable
                                 dataShapeName=""
                                 description=""
                                 isMultiRow="false"
                                 name="Script"
                                 ordinal="0">
                                    <DataShape>
                                        <FieldDefinitions>
                                            <FieldDefinition
                                             baseType="STRING"
                                             description="code"
                                             name="code"
                                             ordinal="0"></FieldDefinition>
                                        </FieldDefinitions>
                                    </DataShape>
                                    <Rows>
                                        <Row>
                                            <code>
                                            <![CDATA[
                                            /*
                                             * @name OnScheduledEvent
                                             * @description ScheduledEvent subscription - delegates to RunPeriodicTask
                                             */
                                            logger.info("[" + me.name + "] ScheduledEvent fired at " + eventTime);
                                            me.RunPeriodicTask();
                                            ]]>
                                            </code>
                                        </Row>
                                    </Rows>
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
</Entities>`;
}

// ── Main generation orchestrator ─────────────────────────────────────
function generateArtifacts(answers) {
  const uc    = answers;
  const info  = parseUseCase(uc.useCase || "");
  const label = toProjectName(info.projectBase);
  const base  = toCamel(info.projectBase);
  const proj  = label.includes(".") ? label : label + ".Core";

  const names = {
    projectName:   proj,
    dsName:        `${base}.${info.domain}.DS`,
    vsName:        `${base}.${info.domain}.VS`,
    ttName:        `${base}.${info.domain}.TT`,
    thingName:     `${base}.${info.domain}001.Thing`,
    muName:        `${base}.${info.domain}Dashboard.MU`,
    schedulerName: `${base}.${info.domain}.Scheduler`,
    label,
    desc:          uc.useCase || "",
  };

  const props   = DOMAIN_PROPS[info.domain] || DOMAIN_PROPS.generic;
  const alerts  = (info.hasAlerts || uc.wantsAlerts) ? (DOMAIN_ALERTS[info.domain] || DOMAIN_ALERTS.generic) : [];
  const hasHistory  = info.hasHistory || uc.wantsHistory;
  const hasDashboard = info.hasDashboard || uc.wantsDashboard;
  const hasScheduler = info.hasScheduler || uc.wantsScheduler;

  const ctx = {
    ...names,
    props,
    alerts,
    hasAlerts: alerts.length > 0,
    hasHistory,
    hasDashboard,
    hasScheduler,
    domain: info.domain,
  };

  const artifacts = [];
  let idx = 1;

  artifacts.push({
    filename: `${String(idx++).padStart(2,"0")}_${base}_Project.xml`,
    entityType: "Project",
    content: genProject(ctx),
  });
  artifacts.push({
    filename: `${String(idx++).padStart(2,"0")}_${base}_${info.domain}.DS.xml`,
    entityType: "DataShape",
    content: genDataShape(ctx),
  });
  artifacts.push({
    filename: `${String(idx++).padStart(2,"0")}_${base}_${info.domain}.VS.xml`,
    entityType: "ValueStream",
    content: genValueStream(ctx),
  });
  artifacts.push({
    filename: `${String(idx++).padStart(2,"0")}_${base}_${info.domain}.TT.xml`,
    entityType: "ThingTemplate",
    content: genThingTemplate(ctx),
  });
  artifacts.push({
    filename: `${String(idx++).padStart(2,"0")}_${base}_${info.domain}001.Thing.xml`,
    entityType: "Thing",
    content: genThing(ctx),
  });
  if (hasDashboard) {
    artifacts.push({
      filename: `${String(idx++).padStart(2,"0")}_${base}_dashboard.MU.xml`,
      entityType: "Mashup",
      content: genMashup(ctx),
    });
  }
  if (hasScheduler) {
    artifacts.push({
      filename: `${String(idx++).padStart(2,"0")}_${base}_${info.domain}.Scheduler.xml`,
      entityType: "Scheduler",
      content: genScheduler(ctx),
    });
  }

  return { artifacts, ctx };
}

// ════════════════════════════════════════════════════════════════════
//  CONVERSATION FLOW (State Machine — no API needed)
// ════════════════════════════════════════════════════════════════════

const FLOW = {
  IDLE:        "IDLE",
  ASK_USECASE: "ASK_USECASE",
  ASK_ALERTS:  "ASK_ALERTS",
  ASK_HISTORY: "ASK_HISTORY",
  ASK_DASH:    "ASK_DASHBOARD",
  ASK_SCHED:   "ASK_SCHEDULER",
  GENERATING:  "GENERATING",
  DONE:        "DONE",
};

const QUICK_PROMPTS = [
  "Temperature sensor dashboard with alerts",
  "CNC machine monitoring with OEE",
  "Water quality monitoring system",
  "Energy meter dashboard with trends",
  "Fleet vehicle tracking system",
  "Pump monitoring with vibration alerts",
];

// ════════════════════════════════════════════════════════════════════
//  UI CONSTANTS
// ════════════════════════════════════════════════════════════════════

const ENTITY_ICONS = {
  Project:"📦", DataShape:"📐", ValueStream:"📈",
  ThingTemplate:"🧩", Thing:"⚙️", Mashup:"🖥️", Scheduler:"⏰",
};
const ENTITY_COLORS = {
  Project:      { bg:"#1e3a5f", accent:"#4a9eff" },
  DataShape:    { bg:"#1a3d2e", accent:"#4ade80" },
  ValueStream:  { bg:"#3d1f3d", accent:"#c084fc" },
  ThingTemplate:{ bg:"#3d2b1a", accent:"#fb923c" },
  Thing:        { bg:"#1a2e3d", accent:"#38bdf8" },
  Mashup:       { bg:"#3d1a1a", accent:"#f87171" },
  Scheduler:    { bg:"#2d2d1a", accent:"#facc15" },
};

// ════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════

export default function ThingWorxAgentLocal() {
  const [messages, setMessages]           = useState([]);
  const [flowState, setFlowState]         = useState(FLOW.IDLE);
  const [answers, setAnswers]             = useState({});
  const [input, setInput]                 = useState("");
  const [artifacts, setArtifacts]         = useState([]);
  const [selectedArt, setSelectedArt]     = useState(null);
  const [copied, setCopied]               = useState(false);
  const [generating, setGenerating]       = useState(false);
  const messagesEnd = useRef(null);
  const textarea    = useRef(null);

  // scroll to bottom on new messages
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, generating]);

  // Init greeting
  useEffect(() => {
    addBot(`👋 Welcome to the **ThingWorx AI Development Agent**

I generate complete, import-ready **ThingWorx 9.5 XML** artifacts — **100% free, no API needed**, everything runs in your browser.

Describe your use case and I'll generate:

📦 Project  →  📐 DataShape  →  📈 ValueStream  →  🧩 ThingTemplate  →  ⚙️ Thing  →  🖥️ Mashup

Try one of the quick prompts below, or type your own:`, "intro");
  }, []);

  function addBot(text, id, options = {}) {
    setMessages(prev => [...prev, { id: id || uid(), role: "bot", text, options }]);
  }
  function addUser(text) {
    setMessages(prev => [...prev, { id: uid(), role: "user", text }]);
  }

  function autoResize() {
    if (!textarea.current) return;
    textarea.current.style.height = "auto";
    textarea.current.style.height = Math.min(textarea.current.scrollHeight, 180) + "px";
  }

  async function handleUserInput(text) {
    if (!text.trim()) return;
    addUser(text);
    setInput("");
    if (textarea.current) textarea.current.style.height = "auto";

    if (flowState === FLOW.IDLE || flowState === FLOW.DONE) {
      // Start new session
      const newAnswers = { useCase: text };
      setAnswers(newAnswers);
      setFlowState(FLOW.ASK_ALERTS);
      addBot("Would you like **threshold alerts** on your properties? (e.g. high-temperature alarm, over-speed alert)", uid(),
        { choices: ["✅ Yes, include alerts", "❌ No alerts needed"] });

    } else if (flowState === FLOW.ASK_ALERTS) {
      const wantsAlerts = /yes|✅|y\b|alert|alarm/i.test(text);
      const newAns = { ...answers, wantsAlerts };
      setAnswers(newAns);
      setFlowState(FLOW.ASK_HISTORY);
      addBot("Should I include **historical data querying** via ValueStream? (trend charts, time-series analysis)", uid(),
        { choices: ["✅ Yes, historical data", "❌ Real-time only"] });

    } else if (flowState === FLOW.ASK_HISTORY) {
      const wantsHistory = /yes|✅|histor|trend|time/i.test(text);
      const newAns = { ...answers, wantsHistory };
      setAnswers(newAns);
      setFlowState(FLOW.ASK_DASH);
      addBot("Should I generate a **Mashup dashboard** for visualization?", uid(),
        { choices: ["✅ Yes, generate Mashup", "❌ Backend only"] });

    } else if (flowState === FLOW.ASK_DASH) {
      const wantsDashboard = /yes|✅|dash|mashup|visual/i.test(text);
      const newAns = { ...answers, wantsDashboard };
      setAnswers(newAns);
      setFlowState(FLOW.ASK_SCHED);
      addBot("Do you need a **Scheduler** for periodic tasks? (e.g. alert checks every 5 minutes)", uid(),
        { choices: ["✅ Yes, add Scheduler", "❌ No Scheduler"] });

    } else if (flowState === FLOW.ASK_SCHED) {
      const wantsScheduler = /yes|✅|sched|periodic|cron/i.test(text);
      const finalAnswers = { ...answers, wantsScheduler };
      setAnswers(finalAnswers);
      setFlowState(FLOW.GENERATING);
      setGenerating(true);
      addBot("⚙️ Generating ThingWorx 9.5 XML artifacts...", uid());

      // Simulate async generation (instant but gives UI a beat)
      setTimeout(() => {
        const { artifacts: arts, ctx } = generateArtifacts(finalAnswers);
        setArtifacts(arts);
        setSelectedArt(arts[0]);
        setGenerating(false);
        setFlowState(FLOW.DONE);

        const summary = arts.map(a => `  ${ENTITY_ICONS[a.entityType] || "📄"} **${a.filename}**`).join("\n");
        addBot(`✅ Generated **${arts.length} artifacts** for **${ctx.label}** (domain: _${ctx.domain}_)

**Import order (top → bottom):**
${summary}

Click any file tab on the right to inspect the XML. Use the download buttons to save individual files or download all at once.

Want to generate another solution? Just describe it!`, uid(), { arts });
      }, 400);
    }
  }

  function choiceClick(choice) { handleUserInput(choice); }

  function copyXml(content) {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadOne(art) {
    const blob = new Blob([art.content], { type: "application/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = art.filename; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAll() {
    artifacts.forEach((art, i) => setTimeout(() => downloadOne(art), i * 120));
  }

  function renderText(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/_(.*?)_/g,       "<em>$1</em>")
      .replace(/`(.*?)`/g,       "<code style='background:#1e2d4a;padding:1px 5px;border-radius:3px;font-size:11px'>$1</code>")
      .replace(/\n/g,            "<br/>");
  }

  // XML syntax highlighting
  function syntaxLine(line) {
    const t = line.trimStart();
    if (t.startsWith("<?xml"))           return "#4a6080";
    if (t.startsWith("<!--"))            return "#4a5568";
    if (t.startsWith("<![CDATA[") || t.startsWith("]]>")) return "#7c3aed";
    if (/^<\/[A-Z]/.test(t))             return "#60a5fa";
    if (/^<[A-Z][a-zA-Z]+/.test(t))      return "#f59e0b";
    if (/^<\/[a-z]/.test(t))             return "#60a5fa";
    if (/^<[a-z]/.test(t))               return "#34d399";
    if (t.match(/^\w+[>]?\s*$/))         return "#e2e8f0";
    return "#94a3b8";
  }

  return (
    <div style={{ display:"flex", height:"100vh", background:"#08090f", fontFamily:"'JetBrains Mono','Fira Code',monospace", color:"#e2e8f0", overflow:"hidden" }}>

      {/* ── LEFT: Chat ────────────────────────────────── */}
      <div style={{ flex:"0 0 420px", display:"flex", flexDirection:"column", borderRight:"1px solid #1a2540" }}>

        {/* Header */}
        <div style={{ padding:"14px 18px", background:"#0b0f1e", borderBottom:"1px solid #1a2540", display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:"linear-gradient(135deg,#1d4ed8,#7c3aed)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:"0 0 14px #7c3aed44" }}>⚡</div>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color:"#fff", letterSpacing:"0.04em" }}>ThingWorx AI Agent</div>
            <div style={{ fontSize:10, color:"#4a9eff", marginTop:1 }}>Local · Free · TWX 9.5 · PostgreSQL</div>
          </div>
          <div style={{ marginLeft:"auto", fontSize:10, padding:"3px 8px", borderRadius:4, background:"#0d1b33", color:"#22c55e", border:"1px solid #166534", fontWeight:600 }}>
            ● OFFLINE
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 14px", display:"flex", flexDirection:"column", gap:12 }}>

          {messages.map(msg => (
            <div key={msg.id}>
              <div style={{ display:"flex", gap:10, flexDirection: msg.role==="user" ? "row-reverse" : "row", alignItems:"flex-start" }}>
                {/* Avatar */}
                <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, background: msg.role==="user" ? "linear-gradient(135deg,#1d4ed8,#3b82f6)" : "linear-gradient(135deg,#059669,#10b981)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff" }}>
                  {msg.role==="user" ? "U" : "⚡"}
                </div>
                {/* Bubble */}
                <div style={{ maxWidth:"85%", padding:"10px 14px", borderRadius: msg.role==="user" ? "14px 4px 14px 14px" : "4px 14px 14px 14px", background: msg.role==="user" ? "#1d3461" : "#0f1929", border:`1px solid ${msg.role==="user" ? "#2563eb30" : "#1a2540"}`, fontSize:12, lineHeight:1.7, color:"#cbd5e1" }}>
                  <span dangerouslySetInnerHTML={{ __html: renderText(msg.text) }} />
                </div>
              </div>

              {/* Quick prompts (intro) */}
              {msg.id === "intro" && flowState === FLOW.IDLE && (
                <div style={{ marginTop:10, marginLeft:38, display:"flex", flexDirection:"column", gap:6 }}>
                  {QUICK_PROMPTS.map(p => (
                    <button key={p} onClick={() => handleUserInput(p)} style={{ background:"#0d1929", border:"1px solid #1a3050", borderRadius:7, padding:"7px 12px", cursor:"pointer", color:"#7dd3fc", fontSize:11, fontWeight:600, textAlign:"left", fontFamily:"inherit", transition:"all 0.15s" }}>
                      💡 {p}
                    </button>
                  ))}
                </div>
              )}

              {/* Choice buttons */}
              {msg.options?.choices && (
                <div style={{ marginTop:8, marginLeft:38, display:"flex", flexWrap:"wrap", gap:6 }}>
                  {msg.options.choices.map(c => (
                    <button key={c} onClick={() => choiceClick(c)} style={{ background:"#0d1929", border:"1px solid #1a3050", borderRadius:7, padding:"6px 12px", cursor:"pointer", color:"#94a3b8", fontSize:11, fontWeight:600, fontFamily:"inherit", transition:"all 0.15s" }}>
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {/* Artifact chips */}
              {msg.options?.arts?.length > 0 && (
                <div style={{ marginTop:8, marginLeft:38, display:"flex", flexWrap:"wrap", gap:5 }}>
                  {msg.options.arts.map(art => {
                    const col = ENTITY_COLORS[art.entityType] || ENTITY_COLORS.Thing;
                    return (
                      <button key={art.filename} onClick={() => setSelectedArt(art)} style={{ background: selectedArt?.filename===art.filename ? col.accent+"22" : col.bg, border:`1px solid ${selectedArt?.filename===art.filename ? col.accent : col.accent+"40"}`, borderRadius:5, padding:"4px 9px", cursor:"pointer", color:col.accent, fontSize:10, fontWeight:600, display:"flex", alignItems:"center", gap:4, fontFamily:"inherit" }}>
                        {ENTITY_ICONS[art.entityType]} {art.filename}
                      </button>
                    );
                  })}
                  <button onClick={downloadAll} style={{ background:"#0d1929", border:"1px solid #1a3050", borderRadius:5, padding:"4px 9px", cursor:"pointer", color:"#64748b", fontSize:10, fontWeight:600, fontFamily:"inherit" }}>
                    ⬇ All
                  </button>
                </div>
              )}
            </div>
          ))}

          {generating && (
            <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:"linear-gradient(135deg,#059669,#10b981)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:"#fff" }}>⚡</div>
              <div style={{ padding:"10px 14px", background:"#0f1929", border:"1px solid #1a2540", borderRadius:"4px 14px 14px 14px", display:"flex", gap:5, alignItems:"center" }}>
                {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#3b82f6", animation:"blink 1.2s infinite", animationDelay:`${i*0.2}s` }} />)}
                <span style={{ fontSize:11, color:"#64748b", marginLeft:6 }}>Building XML artifacts…</span>
              </div>
            </div>
          )}
          <div ref={messagesEnd} />
        </div>

        {/* Input */}
        <div style={{ padding:"12px 14px", borderTop:"1px solid #1a2540", background:"#08090f" }}>
          <div style={{ display:"flex", gap:8, alignItems:"flex-end", background:"#0f1929", border:"1px solid #1a3050", borderRadius:10, padding:"8px 12px" }}>
            <textarea ref={textarea} value={input} onChange={e => { setInput(e.target.value); autoResize(); }}
              onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); handleUserInput(input); } }}
              placeholder="Describe your ThingWorx solution…"
              rows={1}
              style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#e2e8f0", fontSize:12, resize:"none", lineHeight:1.5, fontFamily:"inherit", maxHeight:160 }}
            />
            <button onClick={() => handleUserInput(input)} disabled={!input.trim()} style={{ background: input.trim() ? "linear-gradient(135deg,#1d4ed8,#7c3aed)" : "#1a2540", border:"none", borderRadius:7, width:32, height:32, cursor: input.trim() ? "pointer" : "not-allowed", color:"#fff", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              →
            </button>
          </div>
          <div style={{ fontSize:9, color:"#1e2d4a", marginTop:5, textAlign:"center" }}>Enter to send · Shift+Enter for newline · 100% local, zero cost</div>
        </div>
      </div>

      {/* ── RIGHT: XML Viewer ─────────────────────────── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", background:"#06080e", minWidth:0 }}>

        {selectedArt ? (
          <>
            {/* Toolbar */}
            <div style={{ padding:"12px 18px", borderBottom:"1px solid #1a2540", background:"#0b0f1e", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
              <span style={{ fontSize:20 }}>{ENTITY_ICONS[selectedArt.entityType] || "📄"}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{selectedArt.filename}</div>
                <div style={{ fontSize:10, color:"#64748b", marginTop:1 }}>{selectedArt.entityType} · ThingWorx 9.5 XML · {selectedArt.content.split("\n").length} lines</div>
              </div>
              <button onClick={() => copyXml(selectedArt.content)} style={{ background: copied ? "#059669" : "#1a2540", border:`1px solid ${copied ? "#059669" : "#1e3a5f"}`, borderRadius:6, padding:"5px 11px", cursor:"pointer", color: copied ? "#fff" : "#94a3b8", fontSize:11, fontWeight:600, fontFamily:"inherit", transition:"all 0.2s", flexShrink:0 }}>
                {copied ? "✓ Copied!" : "Copy XML"}
              </button>
              <button onClick={() => downloadOne(selectedArt)} style={{ background:"#1a2540", border:"1px solid #1e3a5f", borderRadius:6, padding:"5px 11px", cursor:"pointer", color:"#94a3b8", fontSize:11, fontWeight:600, fontFamily:"inherit", flexShrink:0 }}>
                ⬇ Download
              </button>
              {artifacts.length > 0 && (
                <button onClick={downloadAll} style={{ background:"linear-gradient(135deg,#1d4ed8,#7c3aed)", border:"none", borderRadius:6, padding:"5px 11px", cursor:"pointer", color:"#fff", fontSize:11, fontWeight:600, fontFamily:"inherit", flexShrink:0 }}>
                  ⬇ All ({artifacts.length})
                </button>
              )}
            </div>

            {/* File tabs */}
            {artifacts.length > 1 && (
              <div style={{ display:"flex", overflowX:"auto", background:"#08090f", borderBottom:"1px solid #1a2540", flexShrink:0 }}>
                {artifacts.map(art => {
                  const col   = ENTITY_COLORS[art.entityType] || ENTITY_COLORS.Thing;
                  const active = selectedArt?.filename === art.filename;
                  return (
                    <button key={art.filename} onClick={() => setSelectedArt(art)} style={{ background:"transparent", border:"none", borderBottom: active ? `2px solid ${col.accent}` : "2px solid transparent", padding:"8px 14px", cursor:"pointer", color: active ? col.accent : "#334155", fontSize:10, fontWeight:600, fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0, transition:"all 0.15s" }}>
                      {ENTITY_ICONS[art.entityType]} {art.filename.replace(/^\d+_/,"")}
                    </button>
                  );
                })}
              </div>
            )}

            {/* XML body */}
            <div style={{ flex:1, overflow:"auto" }}>
              <pre style={{ margin:0, padding:"16px 0", fontSize:11, lineHeight:1.75, fontFamily:"'JetBrains Mono','Fira Code','Cascadia Code',monospace", tabSize:4 }}>
                {selectedArt.content.split("\n").map((line, i) => (
                  <div key={i} style={{ display:"flex", minHeight:"1.75em" }}>
                    <span style={{ display:"inline-block", width:44, textAlign:"right", color:"#1e2d4a", userSelect:"none", paddingRight:14, flexShrink:0, fontSize:10, paddingTop:1 }}>{i+1}</span>
                    <span style={{ color: syntaxLine(line), paddingRight:20 }}>{line || " "}</span>
                  </div>
                ))}
              </pre>
            </div>
          </>
        ) : (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, color:"#1a2540" }}>
            <div style={{ fontSize:52, filter:"grayscale(1) opacity(0.3)" }}>⚙️</div>
            <div style={{ fontSize:14, fontWeight:700 }}>XML will appear here</div>
            <div style={{ fontSize:11, color:"#0f2040", textAlign:"center", maxWidth:280 }}>
              Start a conversation on the left to generate import-ready ThingWorx 9.5 XML artifacts
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginTop:4 }}>
              {Object.entries(ENTITY_ICONS).map(([type, icon]) => (
                <div key={type} style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 10px", borderRadius:5, background:"#0a0e1a", border:"1px solid #0f1f33", color:"#1a2d3d", fontSize:11 }}>
                  <span style={{ opacity:0.4 }}>{icon}</span><span>{type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,80%,100%{transform:scale(0.6);opacity:0.3} 40%{transform:scale(1);opacity:1} }
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1a2540;border-radius:3px}
        *{box-sizing:border-box}
      `}</style>
    </div>
  );
}
