import { describe, it, expect } from "bun:test";
import { InferenceService } from "./inference.js";

describe("InferenceService", () => {
    const service = new InferenceService();

    it("should infer schema from CSV", () => {
        const csv = `id,name,age,active,joined_at
1,Alice,30,true,2023-01-01
2,Bob,25.5,false,2023-02-15 10:00:00
3,Charlie,,null,2023-03-10`;

        const { columns, preview } = service.inferSchema(csv, "CSV");

        expect(columns).toHaveLength(5);
        expect(columns[0]).toEqual({ name: "id", type: "Int64", nullable: false, sampleValue: "1" });
        expect(columns[1]).toEqual({ name: "name", type: "String", nullable: false, sampleValue: "Alice" });
        expect(columns[2]).toEqual({ name: "age", type: "Float64", nullable: true, sampleValue: "30" }); // "25.5" forces float, missing value in row 3 forces nullable
        expect(columns[3]).toEqual({ name: "active", type: "Bool", nullable: true, sampleValue: "true" });
        expect(columns[4]).toEqual({ name: "joined_at", type: "DateTime", nullable: false, sampleValue: "2023-01-01" });

        expect(preview).toHaveLength(3);
        // Preview rows are object arrays keyed by column name (header)
        expect(preview[0]["id"]).toBe("1");
        expect(preview[0]["name"]).toBe("Alice");
    });

    it("should infer schema from TSV", () => {
        const tsv = "col1\tcol2\nval1\t100";
        const { columns } = service.inferSchema(tsv, "TSV");

        expect(columns).toHaveLength(2);
        expect(columns[0].name).toBe("col1");
        expect(columns[1].type).toBe("Int64");
    });

    it("should infer schema from JSON array", () => {
        const json = `[
            {"id": 1, "name": "Test"},
            {"id": 2, "name": "Test2", "extra": "data"}
        ]`;
        const { columns, preview } = service.inferSchema(json, "JSON");

        expect(columns.map(c => c.name)).toContain("id");
        expect(columns.map(c => c.name)).toContain("name");
        expect(columns.map(c => c.name)).toContain("extra");

        const extraCol = columns.find(c => c.name === "extra");
        expect(extraCol?.nullable).toBe(true); // missing in first row

        expect(preview).toHaveLength(2);
        expect(preview[0].id).toBe(1);
    });

    it("should infer schema from JSONEachRow (newline delimited)", () => {
        const ndjson = `{"val": 1.1}\n{"val": 2.2}`;
        const { columns } = service.inferSchema(ndjson, "JSON");

        expect(columns[0].type).toBe("Float64");
    });

    it("should handle empty content", () => {
        expect(service.inferSchema("", "CSV")).toEqual({ columns: [], preview: [] });
    });

    it("should sanitize column names", () => {
        const csv = `User Name!,123Start`;
        const { columns } = service.inferSchema(csv + "\nA,B", "CSV");

        expect(columns[0].name).toBe("User_Name_");
        expect(columns[1].name).toBe("_123Start");
    });

    it("should handle quoted CSV values properly", () => {
        const csv = `id,desc\n1,"Hello, World"\n2,"Multi\nLine"`;
        const { columns, preview } = service.inferSchema(csv, "CSV");

        expect(columns[1].name).toBe("desc");
        expect(columns[1].type).toBe("String");

        expect(preview[0]["desc"]).toBe("Hello, World");
    });
});
