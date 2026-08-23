import test from "node:test";
import assert from "node:assert/strict";
import { tabularFromCsv, parseCsv, tabularFromSav, tabularToSavBytes } from "../src/io/index.ts";
import type { TabularData } from "../src/index.ts";

test("csv parser handles quotes and embedded commas", () => {
  const text = 'name,note,score\n"Smith, J","say, ""hi""",3.5\nDoe,plain,2\n';
  const { headers, rows } = parseCsv(text);
  assert.deepEqual(headers, ["name", "note", "score"]);
  assert.equal(rows[0][0], "Smith, J");
  assert.equal(rows[0][1], 'say, "hi"');
  assert.equal(Number(rows[0][2]), 3.5);
});

test("tabularFromCsv infers numeric vs string", () => {
  const text = "id,group,value\n1,A,3.5\n2,B,9.25\n3,A,null\n";
  const data = tabularFromCsv(text);
  assert.equal(data.variables[0].dataType, "numeric");
  assert.equal(data.variables[1].dataType, "string");
  assert.equal(data.rows[2][2], null);
});

test("SAV round-trip preserves variables, values, and missing", () => {
  const data: TabularData = {
    variables: [
      { name: "id", dataType: "numeric", measure: "scale" },
      {
        name: "group",
        dataType: "string",
        measure: "nominal",
        valueLabels: { "1": "Control", "2": "Case" },
      },
      { name: "score", dataType: "numeric", measure: "scale" },
    ],
    rows: [
      [1, "1", 3.5],
      [2, "2", 9.25],
      [3, "1", null],
    ],
  };
  const bytes = tabularToSavBytes(data);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);

  const back = tabularFromSav(bytes);
  const idVar = back.variables.find((v) => v.name === "id")!;
  const groupVar = back.variables.find((v) => v.name === "group")!;
  assert.equal(idVar.dataType, "numeric");
  assert.equal(groupVar.dataType, "string");
  assert.equal(back.rows[0][0], 1);
  assert.equal(back.rows[1][2], 9.25);
  assert.equal(back.rows[2][2], null);
  assert.ok(groupVar.valueLabels && groupVar.valueLabels["1"] === "Control");
});
