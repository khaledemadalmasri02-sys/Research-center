import { Database, Loader2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DatasetSummary } from "./types";

interface LandingViewProps {
  datasets: DatasetSummary[];
  loading: boolean;
  busyImport: boolean;
  busyBuild: boolean;
  // Import panel state
  file: File | null;
  importName: string;
  importFormat: string;
  setFile: (f: File | null) => void;
  setImportName: (n: string) => void;
  setImportFormat: (f: string) => void;
  onImport: () => void;
  // Build panel state
  buildName: string;
  buildColumns: string;
  buildSex: string;
  buildType: string;
  buildSearch: string;
  setBuildName: (n: string) => void;
  setBuildColumns: (c: string) => void;
  setBuildSex: (s: string) => void;
  setBuildType: (t: string) => void;
  setBuildSearch: (s: string) => void;
  onBuild: () => void;
  // Dataset list
  onOpen: (ds: DatasetSummary) => void;
}

export function LandingView(props: LandingViewProps) {
  const { t } = useTranslation();
  const {
    datasets,
    loading,
    busyImport,
    busyBuild,
    file,
    importName,
    importFormat,
    setFile,
    setImportName,
    setImportFormat,
    onImport,
    buildName,
    buildColumns,
    buildSex,
    buildType,
    buildSearch,
    setBuildName,
    setBuildColumns,
    setBuildSex,
    setBuildType,
    setBuildSearch,
    onBuild,
    onOpen,
  } = props;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* ---- Import file panel ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" /> {t("analysis.importFile")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>{t("analysis.datasetName")}</Label>
              <Input
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="My dataset"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("analysis.file")}</Label>
              <Input
                type="file"
                accept=".csv,.xlsx,.sav"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("analysis.format")}</Label>
              <Select value={importFormat} onValueChange={setImportFormat}>
                <SelectTrigger>
                  <SelectValue placeholder="auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="xlsx">XLSX</SelectItem>
                  <SelectItem value="sav">SAV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!file || busyImport} onClick={onImport}>
              {busyImport && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("analysis.import")}
            </Button>
          </CardContent>
        </Card>

        {/* ---- Build-from-query panel ---- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" /> {t("analysis.buildFromQuery")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>{t("analysis.datasetName")}</Label>
              <Input
                value={buildName}
                onChange={(e) => setBuildName(e.target.value)}
                placeholder="Patient dataset"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("analysis.columns")}</Label>
              <Input
                value={buildColumns}
                onChange={(e) => setBuildColumns(e.target.value)}
                placeholder="age, sex, finalConfirmedDiagnosis"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>{t("analysis.sex")}</Label>
                <Input
                  value={buildSex}
                  onChange={(e) => setBuildSex(e.target.value)}
                  placeholder="male"
                />
              </div>
              <div className="space-y-1">
                <Label>{t("analysis.collectionType")}</Label>
                <Input
                  value={buildType}
                  onChange={(e) => setBuildType(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("analysis.search")}</Label>
              <Input
                value={buildSearch}
                onChange={(e) => setBuildSearch(e.target.value)}
              />
            </div>
            <Button disabled={busyBuild} onClick={onBuild}>
              {busyBuild && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("analysis.build")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ---- Datasets list ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("analysis.datasets")}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : datasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("analysis.noDatasets")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.id}</TableCell>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell>{d.source}</TableCell>
                      <TableCell>{d.format}</TableCell>
                      <TableCell>{d.rowCount}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="secondary" onClick={() => onOpen(d)}>
                          {t("analysis.open")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
