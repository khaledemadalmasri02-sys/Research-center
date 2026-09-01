import type { ComponentType, ReactNode } from "react";

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const HomeIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M6 10.5V20h12v-9.5" />
    <path d="M10 20v-5h4v5" />
  </Svg>
);

const PatientsIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" />
  </Svg>
);

const PatientNewIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <circle cx="10" cy="8" r="3" />
    <path d="M4.5 18c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M18 9v5M15.5 11.5h5" />
  </Svg>
);

const CollectionsIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 12h6M9 15.5h6M9 8.5h2" />
  </Svg>
);

const DataAnalysisIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M4 20V11M9 20V5M14 20v-8M19 20v-4" />
    <path d="M3 20h18" />
  </Svg>
);

const FeedbackIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    <path d="M9 10h6M9 13.5h4" />
  </Svg>
);

const MoreFeaturesIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </Svg>
);

const DatabaseIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
  </Svg>
);

const AdminIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />
    <path d="M12 9v4M12 16h.01" />
  </Svg>
);

const ActivityIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M3 12h4l2-6 4 12 2-6h6" />
  </Svg>
);

const ActivityMeIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
    <path d="M3.5 9a8 8 0 0 1 1-2M3.5 15a8 8 0 0 0 1 2" />
  </Svg>
);

const ApiTokensIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <circle cx="8" cy="8" r="4" />
    <path d="M11 11l8 8M16 16l2-2M19 19l2-2" />
  </Svg>
);

const SessionsIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </Svg>
);

const SettingsIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19" />
  </Svg>
);

const PaletteIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z" />
    <circle cx="7.5" cy="11" r="1" />
    <circle cx="11" cy="7.5" r="1" />
    <circle cx="15.5" cy="8.5" r="1" />
  </Svg>
);

const ConsentIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 14l2 2 4-4" />
  </Svg>
);

const DeidentifyIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

const CodingIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13 5l-2 14" />
  </Svg>
);

const CohortIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <circle cx="9" cy="9" r="2.6" />
    <path d="M4 18c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" />
    <circle cx="16" cy="7.5" r="2.2" />
    <path d="M14.5 13c2.4.2 4.5 1.7 4.5 4v1" />
  </Svg>
);

const ValidationIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M4 6h10M4 12h10M4 18h10" />
    <path d="M17 6l1.5 1.5L21 5M17 12l1.5 1.5L21 11M17 18l1.5 1.5L21 17" />
  </Svg>
);

const DicomIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M4 7V5h2M4 17v2h2M20 7V5h-2M20 17v2h-2" />
    <path d="M4 12h16" />
  </Svg>
);

const ExportIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M12 3v11M8 10l4 4 4-4" />
    <path d="M5 19h14" />
  </Svg>
);

const StudiesIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M12 5c-2-1.5-5-1.5-7 0v14c2-1.5 5-1.5 7 0M12 5c2-1.5 5-1.5 7 0v14c-2-1.5-5-1.5-7 0" />
    <path d="M12 5v14" />
  </Svg>
);

const MlIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M9 4.5A2.5 2.5 0 0 0 6.5 7 2.5 2.5 0 0 0 4 9.5 2.5 2.5 0 0 0 6 14a2.5 2.5 0 0 0 4.5 1.5V5.5A2.5 2.5 0 0 0 9 4.5z" />
    <path d="M15 4.5A2.5 2.5 0 0 1 17.5 7 2.5 2.5 0 0 1 20 9.5 2.5 2.5 0 0 1 18 14a2.5 2.5 0 0 1-4.5 1.5" />
  </Svg>
);

const ReportsIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 12v5M12 10v7M15 13v4" />
  </Svg>
);

const GdprIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M7 4h10a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <path d="M7 4a2 2 0 0 0-2 2M9 9h6M9 12h6M9 15h4" />
  </Svg>
);

const IngestIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M7 18a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.5 3.5 0 0 1 17 18" />
    <path d="M12 12v6M9.5 14.5 12 12l2.5 2.5" />
  </Svg>
);

const SearchIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </Svg>
);

const RecordsListIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1.2" />
    <circle cx="4" cy="12" r="1.2" />
    <circle cx="4" cy="18" r="1.2" />
  </Svg>
);

const CollectionNewIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M12 11v6M9 14h6" />
  </Svg>
);

const CollectionEditIcon: ComponentType<IconProps> = ({ className }) => (
  <Svg className={className}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
    <path d="M9 13l4-1 1 4-4 1zM14 14l3 3" />
  </Svg>
);

export const APP_SVG_ICONS: Record<string, ComponentType<IconProps>> = {
  home: HomeIcon,
  patients: PatientsIcon,
  "patients/new": PatientNewIcon,
  collections: CollectionsIcon,
  "data-analysis": DataAnalysisIcon,
  feedback: FeedbackIcon,
  "more-features": MoreFeaturesIcon,
  database: DatabaseIcon,
  admin: AdminIcon,
  activity: ActivityIcon,
  "activity/me": ActivityMeIcon,
  "api-tokens": ApiTokensIcon,
  sessions: SessionsIcon,
  settings: SettingsIcon,
  "theme-manager": PaletteIcon,
  consent: ConsentIcon,
  deidentify: DeidentifyIcon,
  coding: CodingIcon,
  cohort: CohortIcon,
  validation: ValidationIcon,
  dicom: DicomIcon,
  export: ExportIcon,
  studies: StudiesIcon,
  ml: MlIcon,
  reports: ReportsIcon,
  gdpr: GdprIcon,
  ingest: IngestIcon,
  search: SearchIcon,
  "records/:definitionId": RecordsListIcon,
  "collections/new": CollectionNewIcon,
  "collections/:id/edit": CollectionEditIcon,
};
