import React from "react";
import {
  WelcomeScene,
  DashboardScene,
  PatientsScene,
  CollectionsScene,
  DataAnalysisScene,
  FeedbackScene,
  MoreFeaturesScene,
  MyActivityScene,
  ApiTokensScene,
  SessionsScene,
  NotificationsScene,
  ThemeScene,
  LanguageScene,
  AdminScene,
  FinishScene,
} from "./scenes";

const MAP: Record<string, React.FC> = {
  welcome: WelcomeScene,
  dashboard: DashboardScene,
  patients: PatientsScene,
  collections: CollectionsScene,
  dataAnalysis: DataAnalysisScene,
  feedback: FeedbackScene,
  moreFeatures: MoreFeaturesScene,
  myActivity: MyActivityScene,
  apiTokens: ApiTokensScene,
  sessions: SessionsScene,
  notifications: NotificationsScene,
  theme: ThemeScene,
  language: LanguageScene,
  admin: AdminScene,
  finish: FinishScene,
};

export const TourVideo: React.FC<{ stepKey: string }> = ({ stepKey }) => {
  const Cmp = MAP[stepKey] ?? WelcomeScene;
  return <Cmp />;
};
