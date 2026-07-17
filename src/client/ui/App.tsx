import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  Factory,
  Filter,
  Gauge,
  Globe2,
  LayoutDashboard,
  ListChecks,
  Menu,
  MoreHorizontal,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Target,
  TrendingUp,
  UserRound,
  X,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CollectionChannelSummary,
  CollectionDashboard,
  CollectionRecord,
  FeedbackAction,
  ManualOpportunityInput,
  OpportunityStatus,
  ProductOpportunity,
  SupplySignal
} from "../../shared/types";
import {
  beginIntegrationAuthorization,
  createManualOpportunityRequest,
  fetchCollectionDashboard,
  fetchIntegrationStatus,
  fetchOpportunities,
  presentBusinessError,
  runCollectionRequest,
  searchSupplyRequest,
  sendFeedback,
  testSourceRequest,
  type CommerceIntegration,
  type IntegrationAuthorizationStatus
} from "./api";
import {
  DataState,
  EmptyState,
  Kpi,
  LoadingState,
  OutcomeBadge,
  PageHeading,
  RiskBadge,
  Score,
  StatusBadge
} from "./UiPrimitives";

type PageId = "opportunities" | "collection" | "channels" | "supply" | "sources" | "tasks";
type ViewMode = "table" | "cards";
const statusLabels: Record<OpportunityStatus, string> = {
  new: "新机会",
  watching: "观察中",
  follow_up: "待跟进",
  verifying: "验证中",
  sampling: "已打样",
  listed: "已上架",
  rejected: "已放弃"
};

const stageLabels: Record<ProductOpportunity["evidence"]["stage"], string> = {
  signal: "信号",
  hypothesis: "机会假设",
  validating: "验证中",
  actionable: "可行动"
};

const navItems: Array<{ id: PageId; label: string; icon: typeof LayoutDashboard }> = [
  { id: "opportunities", label: "商业机会", icon: LayoutDashboard },
  { id: "collection", label: "今日采集", icon: Activity },
  { id: "channels", label: "渠道洞察", icon: BarChart3 },
  { id: "supply", label: "供给验证", icon: Factory },
  { id: "sources", label: "数据源", icon: Database },
  { id: "tasks", label: "任务与复盘", icon: ListChecks }
];

const marketLabels: Record<string, string> = {
  AU: "澳大利亚",
  GB: "英国",
  CN: "中国",
  US: "美国",
  IT: "意大利",
  ES: "西班牙",
  CA: "加拿大",
  FR: "法国",
  HK: "中国香港",
  DE: "德国"
};

export function App() {
  const [page, setPage] = useState<PageId>("opportunities");
  const [selectedOpportunity, setSelectedOpportunity] = useState<ProductOpportunity | null>(null);
  const [opportunities, setOpportunities] = useState<ProductOpportunity[]>([]);
  const [dashboard, setDashboard] = useState<CollectionDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pendingFeedbackId, setPendingFeedbackId] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const [nextOpportunities, nextDashboard] = await Promise.all([
        fetchOpportunities(signal),
        fetchCollectionDashboard(signal)
      ]);
      if (requestId === requestIdRef.current) {
        setOpportunities(nextOpportunities);
        setDashboard(nextDashboard);
        setSelectedOpportunity((current) =>
          current ? (nextOpportunities.find((item) => item.id === current.id) ?? current) : null
        );
      }
    } catch (loadError) {
      if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
        setError(presentBusinessError(loadError, "数据加载失败，请稍后重试"));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const navigate = (nextPage: PageId) => {
    setPage(nextPage);
    setSelectedOpportunity(null);
    setMobileNavOpen(false);
  };

  const handleFeedback = async (
    opportunity: ProductOpportunity,
    action: FeedbackAction["action"],
    metadata: Pick<FeedbackAction, "owner" | "dueDate" | "note"> = {}
  ) => {
    setPendingFeedbackId(opportunity.id);
    setError(null);
    try {
      await sendFeedback({
        opportunityId: opportunity.id,
        action,
        ...metadata,
        note: metadata.note ?? (action === "sampling" ? "由商业机会工作台创建打样任务" : undefined)
      });
      await load();
    } catch (feedbackError) {
      setError(presentBusinessError(feedbackError, "反馈提交失败，请稍后重试"));
    } finally {
      setPendingFeedbackId(null);
    }
  };

  return (
    <div className={`product-app ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <Sidebar
        page={page}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onNavigate={navigate}
        onCollapse={() => setSidebarCollapsed((value) => !value)}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <div className="product-main">
        <Topbar
          dashboard={dashboard}
          onMenu={() => setMobileNavOpen(true)}
          onRefresh={() => void load()}
          loading={loading}
        />
        <main className="product-content">
          {error && (
            <div className="notice notice-error" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="关闭错误提示">
                <X size={16} />
              </button>
            </div>
          )}
          {loading && opportunities.length === 0 ? (
            <LoadingState />
          ) : selectedOpportunity ? (
            <OpportunityDetail
              opportunity={selectedOpportunity}
              pending={pendingFeedbackId === selectedOpportunity.id}
              onBack={() => setSelectedOpportunity(null)}
              onFeedback={(action, metadata) => void handleFeedback(selectedOpportunity, action, metadata)}
            />
          ) : (
            <>
              {page === "opportunities" && (
                <OpportunitiesPage
                  opportunities={opportunities}
                  dashboard={dashboard}
                  onSelect={setSelectedOpportunity}
                  onFeedback={(opportunity, action) => void handleFeedback(opportunity, action)}
                  pendingFeedbackId={pendingFeedbackId}
                  onShowSources={() => navigate("sources")}
                  onReload={() => load()}
                />
              )}
              {page === "collection" && <CollectionPage dashboard={dashboard} onRefresh={() => load()} />}
              {page === "channels" && <ChannelsPage dashboard={dashboard} />}
              {page === "supply" && <SupplyPage opportunities={opportunities} onSelect={setSelectedOpportunity} />}
              {page === "sources" && (
                <SourcesPage dashboard={dashboard} onShowCollection={() => navigate("collection")} />
              )}
              {page === "tasks" && <TasksPage opportunities={opportunities} onSelect={setSelectedOpportunity} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  page,
  collapsed,
  mobileOpen,
  onNavigate,
  onCollapse,
  onCloseMobile
}: {
  page: PageId;
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate: (page: PageId) => void;
  onCollapse: () => void;
  onCloseMobile: () => void;
}) {
  return (
    <>
      {mobileOpen && <button className="nav-scrim" type="button" onClick={onCloseMobile} aria-label="关闭导航" />}
      <aside className={`product-sidebar ${mobileOpen ? "is-mobile-open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark">
            <Zap size={19} />
          </div>
          {!collapsed && (
            <div>
              <strong>雁巢机会雷达</strong>
              <span>Opportunity Intelligence</span>
            </div>
          )}
        </div>
        <nav className="primary-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={page === item.id ? "is-active" : ""}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="environment-chip">
            <span />
            {!collapsed && "生产数据模式"}
          </div>
          <button type="button" className="collapse-button" onClick={onCollapse} aria-label="收起或展开侧栏">
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>收起侧栏</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

function Topbar({
  dashboard,
  onMenu,
  onRefresh,
  loading
}: {
  dashboard: CollectionDashboard | null;
  onMenu: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const failed = dashboard?.channels.filter((item) => !item.ok).length ?? 0;
  return (
    <header className="product-topbar">
      <button className="mobile-menu" type="button" onClick={onMenu} aria-label="打开导航">
        <Menu size={20} />
      </button>
      <div className="topbar-context">
        <span className={`system-dot ${failed > 0 ? "is-warning" : ""}`} />
        <strong>{failed > 0 ? `${failed} 个渠道需要处理` : "采集系统运行正常"}</strong>
        <span>{dashboard ? `最近更新 ${formatTime(dashboard.generatedAt)}` : "等待首次采集"}</span>
      </div>
      <div className="topbar-actions">
        <button type="button" className="topbar-button" onClick={onRefresh} aria-label="刷新数据">
          <RefreshCw size={17} className={loading ? "is-spinning" : ""} />
        </button>
        <button type="button" className="topbar-button" aria-label="通知" disabled title="暂无未读通知">
          <Bell size={17} />
        </button>
        <div className="user-chip">
          <span>YC</span>
          <div>
            <strong>选品负责人</strong>
            <small>管理员</small>
          </div>
        </div>
      </div>
    </header>
  );
}

function OpportunitiesPage({
  opportunities,
  dashboard,
  onSelect,
  onFeedback,
  pendingFeedbackId,
  onShowSources,
  onReload
}: {
  opportunities: ProductOpportunity[];
  dashboard: CollectionDashboard | null;
  onSelect: (opportunity: ProductOpportunity) => void;
  onFeedback: (opportunity: ProductOpportunity, action: FeedbackAction["action"]) => void;
  pendingFeedbackId: string | null;
  onShowSources: () => void;
  onReload: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("all");
  const [stage, setStage] = useState("all");
  const [view, setView] = useState<ViewMode>("table");
  const [showScoring, setShowScoring] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return opportunities.filter((item) => {
      const matchesQuery =
        !keyword ||
        [item.productName, item.eventName, item.category, item.market].join(" ").toLowerCase().includes(keyword);
      const matchesMarket = market === "all" || item.market === market;
      const matchesStage = stage === "all" || item.evidence.stage === stage;
      return matchesQuery && matchesMarket && matchesStage;
    });
  }, [market, opportunities, query, stage]);
  const highValue = opportunities.filter(
    (item) => item.scores.overall >= 70 && item.evidence.stage !== "signal"
  ).length;
  const actionable = opportunities.filter((item) => item.evidence.stage === "actionable").length;
  const successRate = dashboard?.channels.length
    ? Math.round((dashboard.channels.filter((item) => item.ok).length / dashboard.channels.length) * 100)
    : 0;

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Opportunity workspace"
        title="商业机会"
        description="从跨渠道信号中识别、验证并推进真正值得做的商品机会。"
      >
        <button type="button" className="button secondary" onClick={() => setShowScoring(true)}>
          <Settings2 size={16} />
          评分口径
        </button>
        <button type="button" className="button primary" onClick={() => setShowManual(true)}>
          <Target size={16} />
          新建人工机会
        </button>
      </PageHeading>
      <section className="kpi-grid" aria-label="经营概览">
        <Kpi
          label="今日采集"
          value={dashboard?.totalCollected ?? 0}
          suffix="条"
          note={`${dashboard?.liveCount ?? 0} 条真实数据`}
          icon={<Activity size={19} />}
        />
        <Kpi
          label="机会总数"
          value={opportunities.length}
          suffix="个"
          note={`${actionable} 个已可行动`}
          icon={<Target size={19} />}
        />
        <Kpi
          label="高优机会"
          value={highValue}
          suffix="个"
          note="评分 ≥ 70 且证据非单一"
          icon={<TrendingUp size={19} />}
          tone="positive"
        />
        <Kpi
          label="待验证"
          value={opportunities.filter((item) => item.evidence.blockers.length > 0).length}
          suffix="个"
          note="优先补齐销售与供给证据"
          icon={<Clock3 size={19} />}
          tone="warning"
        />
        <Kpi
          label="采集成功率"
          value={successRate}
          suffix="%"
          note={`${dashboard?.channels.filter((item) => !item.ok).length ?? 0} 个渠道异常`}
          icon={<Gauge size={19} />}
        />
      </section>
      {(dashboard?.channels.some((item) => !item.ok) ?? false) && (
        <section className="attention-strip">
          <AlertTriangle size={18} />
          <div>
            <strong>数据完整度提醒</strong>
            <span>淘宝授权或 Amazon 销售数据尚未完成，相关机会不会被评为“证据完整”。</span>
          </div>
          <button type="button" className="text-button" onClick={onShowSources}>
            查看数据源 <ChevronRight size={15} />
          </button>
        </section>
      )}
      <section className="panel">
        <div className="panel-toolbar">
          <div className="filter-row">
            <label className="search-field">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索机会、商品、事件"
              />
            </label>
            <label className="select-field">
              <Globe2 size={16} />
              <select value={market} onChange={(event) => setMarket(event.target.value)}>
                <option value="all">全部市场</option>
                {[...new Set(opportunities.map((item) => item.market))].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="select-field">
              <Filter size={16} />
              <select value={stage} onChange={(event) => setStage(event.target.value)}>
                <option value="all">全部阶段</option>
                <option value="signal">信号</option>
                <option value="hypothesis">机会假设</option>
                <option value="validating">验证中</option>
                <option value="actionable">可行动</option>
              </select>
            </label>
          </div>
          <div className="segmented">
            <button type="button" className={view === "table" ? "is-active" : ""} onClick={() => setView("table")}>
              列表
            </button>
            <button type="button" className={view === "cards" ? "is-active" : ""} onClick={() => setView("cards")}>
              卡片
            </button>
          </div>
        </div>
        <div className="table-caption">
          <strong>机会池</strong>
          <span>共 {filtered.length} 个 · 按综合评分排序</span>
        </div>
        {view === "table" ? (
          <div className="data-table-wrap">
            <table className="data-table opportunity-table">
              <thead>
                <tr>
                  <th>机会</th>
                  <th>市场</th>
                  <th>证据来源</th>
                  <th>供给验证</th>
                  <th>销售验证</th>
                  <th>评分</th>
                  <th>阶段</th>
                  <th>负责人</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <OpportunityRow
                    key={item.id}
                    opportunity={item}
                    onSelect={onSelect}
                    onSample={() => onFeedback(item, "sampling")}
                    pending={pendingFeedbackId === item.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="opportunity-card-grid">
            {filtered.map((item) => (
              <article className="opportunity-card" key={item.id}>
                <div className="opportunity-card-top">
                  <EvidenceStage opportunity={item} />
                  <Score value={item.scores.overall} />
                </div>
                <button type="button" className="card-title-button" onClick={() => onSelect(item)}>
                  <strong>{item.productName}</strong>
                  <span>
                    {item.eventName} · {item.market}
                  </span>
                </button>
                <p>{item.analysis.decision}</p>
                <div className="mini-evidence">
                  <span className={item.supply.origin === "live" ? "is-live" : ""}>
                    供给 {item.supply.origin === "live" ? "实时" : "待验证"}
                  </span>
                  <span className={item.sales.origin === "live" ? "is-live" : ""}>
                    销售 {item.sales.origin === "live" ? "实时" : "待接入"}
                  </span>
                </div>
                <div className="card-action-row">
                  <button type="button" className="button secondary" onClick={() => onSelect(item)}>
                    查看详情
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={pendingFeedbackId === item.id}
                    onClick={() => onFeedback(item, "sampling")}
                  >
                    打样
                  </button>
                </div>
                <small>下一步：{item.analysis.nextBestAction}</small>
              </article>
            ))}
          </div>
        )}
        {filtered.length === 0 && (
          <EmptyState
            icon={<Search size={24} />}
            title="没有匹配的商业机会"
            description="调整市场、阶段或搜索条件后重试。"
          />
        )}
      </section>
      {showScoring && <ScoringRubricDialog onClose={() => setShowScoring(false)} />}
      {showManual && (
        <ManualOpportunityDialog
          onClose={() => setShowManual(false)}
          onCreate={async (input) => {
            const opportunity = await createManualOpportunityRequest(input);
            setShowManual(false);
            await onReload();
            onSelect(opportunity);
          }}
        />
      )}
    </div>
  );
}

function OpportunityRow({
  opportunity,
  onSelect,
  onSample,
  pending
}: {
  opportunity: ProductOpportunity;
  onSelect: (item: ProductOpportunity) => void;
  onSample: () => void;
  pending: boolean;
}) {
  const platforms = opportunity.trendSignals.map((item) => item.sourcePlatform ?? item.source).filter(Boolean);
  return (
    <tr onClick={() => onSelect(opportunity)}>
      <td>
        <button type="button" className="opportunity-name">
          <strong>{opportunity.productName}</strong>
          <span>{opportunity.eventName}</span>
          <small>{opportunity.suggestedActions[0]}</small>
        </button>
      </td>
      <td>
        <span className="market-code">{opportunity.market}</span>
      </td>
      <td>
        <div className="source-stack">
          <strong>{platforms.length || opportunity.evidence.uniqueTrendPlatforms.length} 个来源</strong>
          <span>
            {platforms.slice(0, 2).join("、") ||
              opportunity.evidence.uniqueTrendPlatforms.slice(0, 2).join("、") ||
              "等待真实信号"}
          </span>
        </div>
      </td>
      <td>
        <DataState
          live={opportunity.supply.origin === "live"}
          liveText={supplierCountText(opportunity.supply)}
          fallbackText="待真实供给"
        />
      </td>
      <td>
        <DataState
          live={opportunity.sales.origin === "live"}
          liveText={opportunity.sales.platform}
          fallbackText="Amazon 待接入"
        />
      </td>
      <td>
        <Score value={opportunity.scores.overall} />
      </td>
      <td>
        <EvidenceStage opportunity={opportunity} />
      </td>
      <td>
        <div className="owner-cell">
          <span>{initials(opportunity.owner ?? "未指派")}</span>
          {opportunity.owner ?? "未指派"}
        </div>
      </td>
      <td>
        <button
          type="button"
          className="quick-sample"
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation();
            onSample();
          }}
        >
          打样
        </button>
      </td>
    </tr>
  );
}

function OpportunityDetail({
  opportunity,
  pending,
  onBack,
  onFeedback
}: {
  opportunity: ProductOpportunity;
  pending: boolean;
  onBack: () => void;
  onFeedback: (action: FeedbackAction["action"], metadata?: Pick<FeedbackAction, "owner" | "dueDate" | "note">) => void;
}) {
  const [tab, setTab] = useState("judgement");
  const [dialog, setDialog] = useState<"assign" | "sample" | null>(null);
  const scoreItems = [
    ["趋势强度", opportunity.scores.trend],
    ["供给可得性", opportunity.scores.supply],
    ["毛利代理", opportunity.scores.monetization],
    ["竞争空间", opportunity.scores.competition],
    ["风险安全", opportunity.scores.risk],
    ["证据完整度", opportunity.scores.evidenceCompleteness]
  ] as const;
  return (
    <div className="page-stack">
      <button type="button" className="back-button" onClick={onBack}>
        <ArrowLeft size={17} />
        返回机会池
      </button>
      <section className="detail-hero">
        <div>
          <div className="detail-meta">
            <EvidenceStage opportunity={opportunity} />
            <span>{opportunity.market}</span>
            <span>{opportunity.category}</span>
            <span>更新于 {formatTime(opportunity.updatedAt)}</span>
          </div>
          <h1>{opportunity.productName}</h1>
          <p>
            {opportunity.eventName} · {opportunity.demand}
          </p>
        </div>
        <div className="detail-score">
          <Score value={opportunity.scores.overall} large />
          <span>综合评分</span>
        </div>
        <div className="detail-actions">
          <button type="button" className="button secondary" onClick={() => setDialog("assign")}>
            <UserRound size={16} />
            指派
          </button>
          <button type="button" className="button primary" disabled={pending} onClick={() => setDialog("sample")}>
            <Factory size={16} />
            创建打样
          </button>
          <button type="button" className="icon-button-soft" aria-label="更多操作" disabled title="暂无更多操作">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </section>
      <div className="detail-tabs">
        {[
          ["judgement", "机会判断"],
          ["evidence", "原始证据"],
          ["supply", "供给样本"],
          ["validation", "验证记录"],
          ["log", "操作日志"]
        ].map(([id, label]) => (
          <button type="button" key={id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "judgement" && (
        <>
          <section className="decision-grid">
            <DecisionBlock
              label="机会结论"
              text={opportunity.analysis.decision}
              icon={<Target size={18} />}
              tone="primary"
            />
            <DecisionBlock label="为什么现在" text={opportunity.analysis.signal} icon={<TrendingUp size={18} />} />
            <DecisionBlock
              label="主要风险"
              text={opportunity.analysis.blockers[0] ?? "当前未发现高风险阻塞项"}
              icon={<ShieldCheck size={18} />}
              tone="warning"
            />
            <DecisionBlock
              label="下一步最佳动作"
              text={opportunity.analysis.nextBestAction}
              icon={<ArrowUpRight size={18} />}
              tone="positive"
            />
          </section>
          <section className="detail-two-column">
            <div className="panel">
              <SectionTitle title="证据链" subtitle="信号如何逐步变成可执行机会" />
              <EvidenceTimeline opportunity={opportunity} />
            </div>
            <div className="panel">
              <SectionTitle title="评分拆解" subtitle={`决策准备度 ${opportunity.scores.decisionReadiness}%`} />
              <div className="score-breakdown">
                {scoreItems.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <div>
                      <i style={{ width: `${Math.max(3, value)}%` }} />
                    </div>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="detail-two-column wide-left">
            <div className="panel">
              <SectionTitle title="国家趋势对比" subtitle="仅展示该商品本次采集到的真实国家趋势" />
              {(opportunity.marketTrends?.length ?? 0) > 0 ? (
                <div className="country-bars">
                  {opportunity.marketTrends?.map((point, index) => (
                    <div key={point.market}>
                      <span>{index + 1}</span>
                      <strong>{marketLabels[point.market] ?? point.market}</strong>
                      <div>
                        <i style={{ width: `${point.value}%` }} />
                      </div>
                      <b>{point.value}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Globe2 size={24} />}
                  title="暂无可比较的真实国家趋势"
                  description="当前机会还没有 country × keyword 的实时数据，因此不展示推测值。"
                />
              )}
            </div>
            <div className="panel">
              <SectionTitle title="验证门槛" subtitle="进入可行动阶段前必须补齐" />
              <ValidationGate opportunity={opportunity} />
            </div>
          </section>
        </>
      )}
      {tab === "evidence" && <EvidenceRecords opportunity={opportunity} />}
      {tab === "supply" && <SupplyDetail opportunity={opportunity} />}
      {tab === "validation" && <ValidationHistory opportunity={opportunity} />}
      {tab === "log" && <ActivityLog opportunity={opportunity} />}
      {dialog && (
        <ActionDialog
          kind={dialog}
          opportunity={opportunity}
          onClose={() => setDialog(null)}
          onConfirm={(metadata) => {
            setDialog(null);
            onFeedback(dialog === "sample" ? "sampling" : "follow_up", metadata);
          }}
        />
      )}
    </div>
  );
}

function CollectionPage({
  dashboard,
  onRefresh
}: {
  dashboard: CollectionDashboard | null;
  onRefresh: () => Promise<void>;
}) {
  const [channel, setChannel] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [selected, setSelected] = useState<CollectionRecord | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const startCollection = async () => {
    setCollecting(true);
    setActionError(null);
    setProgress(8);
    const timer = window.setInterval(() => setProgress((value) => Math.min(88, value + 7)), 450);
    try {
      await runCollectionRequest();
      setProgress(100);
      await onRefresh();
    } catch (error) {
      setActionError(presentBusinessError(error, "采集任务执行失败，请稍后重试"));
    } finally {
      window.clearInterval(timer);
      window.setTimeout(() => {
        setCollecting(false);
        setProgress(0);
      }, 350);
    }
  };
  const records =
    dashboard?.records.filter(
      (record) => (channel === "all" || record.channel === channel) && (outcome === "all" || record.outcome === outcome)
    ) ?? [];
  const channels = useMemo(() => dashboard?.channels ?? [], [dashboard]);
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Collection control center"
        title="今日采集中心"
        description="看清每个渠道今天采了什么、哪些进入分析，以及失败发生在哪里。"
      >
        <button type="button" className="button primary" onClick={startCollection} disabled={collecting}>
          <Play size={16} />
          {collecting ? "采集中" : "立即采集"}
        </button>
      </PageHeading>
      {actionError && (
        <div className="notice notice-error" role="alert">
          <AlertTriangle size={17} />
          <span>{actionError}</span>
        </div>
      )}
      {collecting && (
        <section className="collection-progress">
          <div>
            <strong>正在执行多渠道真实采集</strong>
            <span>{progress}% · 统一采集模块正在更新趋势、热榜与供给数据</span>
          </div>
          <div>
            <i style={{ width: `${progress}%` }} />
          </div>
        </section>
      )}
      <section className="kpi-grid compact">
        <Kpi
          label="今日原始数据"
          value={dashboard?.totalCollected ?? 0}
          suffix="条"
          note="去重后的渠道记录"
          icon={<Database size={19} />}
        />
        <Kpi
          label="真实采集"
          value={dashboard?.liveCount ?? 0}
          suffix="条"
          note="不含 Seed 回退"
          icon={<Zap size={19} />}
          tone="positive"
        />
        <Kpi
          label="进入分析"
          value={dashboard?.mappedCount ?? 0}
          suffix="条"
          note="识别出商品机会"
          icon={<Target size={19} />}
        />
        <Kpi
          label="商业验证样本"
          value={dashboard?.validationCount ?? 0}
          suffix="条"
          note="供给/销售验证，不计入趋势映射"
          icon={<Factory size={19} />}
        />
        <Kpi
          label="保留未命中"
          value={dashboard?.filteredCount ?? 0}
          suffix="条"
          note="用于优化识别规则"
          icon={<Filter size={19} />}
        />
      </section>
      <section className="channel-card-grid">
        {channels.map((item) => (
          <ChannelCard
            key={item.id}
            channel={item}
            active={channel === item.id}
            onClick={() => setChannel(channel === item.id ? "all" : item.id)}
          />
        ))}
      </section>
      <section className="panel">
        <div className="panel-toolbar">
          <div className="filter-row">
            <label className="select-field">
              <Database size={16} />
              <select value={channel} onChange={(event) => setChannel(event.target.value)}>
                <option value="all">全部渠道</option>
                {channels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-field">
              <Filter size={16} />
              <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
                <option value="all">全部结果</option>
                <option value="mapped">进入分析</option>
                <option value="filtered">未命中规则</option>
                <option value="validation">商业验证</option>
                <option value="demo">Seed 演示</option>
              </select>
            </label>
          </div>
          <span className="result-count">当前显示 {records.length} 条</span>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>采集时间</th>
                <th>渠道 / 平台</th>
                <th>国家</th>
                <th>原始采集内容</th>
                <th>原始指标</th>
                <th>处理结果</th>
                <th>识别与原因</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 80).map((record) => (
                <tr key={`${record.channel}-${record.id}`}>
                  <td>{formatTime(record.collectedAt)}</td>
                  <td>
                    <strong>{channelLabel(channels, record.channel)}</strong>
                    <small>{record.platform}</small>
                  </td>
                  <td>
                    <span className="market-code">{record.market ?? "--"}</span>
                  </td>
                  <td className="record-title">{record.title}</td>
                  <td>{formatMetric(record)}</td>
                  <td>
                    <OutcomeBadge outcome={record.outcome} />
                  </td>
                  <td>
                    <strong>{record.mappedKeyword ?? "未映射"}</strong>
                    <small>{record.reason}</small>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-ghost"
                      onClick={() => setSelected(record)}
                      aria-label="查看原始数据"
                    >
                      <ChevronRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {records.length === 0 && (
          <EmptyState
            icon={<Database size={24} />}
            title="当前筛选下没有采集记录"
            description="请选择其他渠道或处理结果。"
          />
        )}
      </section>
      {selected && <JsonDrawer record={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ChannelsPage({ dashboard }: { dashboard: CollectionDashboard | null }) {
  const channels = dashboard?.channels ?? [];
  const [selected, setSelected] = useState<CollectionChannelSummary | null>(null);
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Channel intelligence"
        title="渠道洞察"
        description="比较各渠道的覆盖范围、映射效率、可靠性与运行延迟。"
      />
      <section className="panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>渠道</th>
                <th>定位</th>
                <th>今日记录</th>
                <th>商品映射率</th>
                <th>可靠性</th>
                <th>最近运行</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {channels.map((item) => {
                const rate = item.rawCount ? Math.round((item.mappedCount / item.rawCount) * 100) : 0;
                return (
                  <tr key={item.id} onClick={() => setSelected(item)}>
                    <td>
                      <strong>{item.label}</strong>
                    </td>
                    <td className="record-title">{item.description}</td>
                    <td>{item.rawCount}</td>
                    <td>
                      {item.purpose === "discovery" ? (
                        <div className="inline-progress">
                          <div>
                            <i style={{ width: `${rate}%` }} />
                          </div>
                          <span>{rate}%</span>
                        </div>
                      ) : (
                        <span className="muted">不适用</span>
                      )}
                    </td>
                    <td>
                      <RiskBadge risk={item.riskLevel ?? "medium"} />
                    </td>
                    <td>{formatTime(item.lastCheckedAt)}</td>
                    <td>
                      <StatusBadge ok={item.ok} />
                    </td>
                    <td>
                      <ChevronRight size={17} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="workflow-panel">
        <div>
          <Globe2 size={21} />
          <strong>Google Trends 发现流程</strong>
        </div>
        <ol>
          <li>
            <span>1</span>
            <div>
              <strong>按国家读取 Trending Now</strong>
              <small>10 个目标市场，无需预设关键词</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>识别商品与消费场景</strong>
              <small>过滤纯新闻和非商业意图热点</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>关键词二次验证</strong>
              <small>只验证已发现候选，不承担热点发现</small>
            </div>
          </li>
          <li>
            <span>4</span>
            <div>
              <strong>合并供给与销售证据</strong>
              <small>达到门槛后进入商业机会池</small>
            </div>
          </li>
        </ol>
      </section>
      {selected && <ChannelDrawer channel={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SupplyPage({
  opportunities,
  onSelect
}: {
  opportunities: ProductOpportunity[];
  onSelect: (item: ProductOpportunity) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SupplySignal | null>(null);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const searchSupply = async () => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setSearchError("请输入至少 2 个字符的商品关键词");
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      setSearchResult(await searchSupplyRequest(keyword));
    } catch (error) {
      setSearchError(presentBusinessError(error, "供给搜索失败，请稍后重试"));
    } finally {
      setSearching(false);
    }
  };
  const authorize = async (integration: CommerceIntegration) => {
    setSearchError(null);
    try {
      await beginIntegrationAuthorization(integration);
    } catch (error) {
      setSearchError(presentBusinessError(error, "暂时无法发起平台授权"));
    }
  };
  const toggleComparison = (id: string) =>
    setComparisonIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-4)
    );
  const items = opportunities.filter((item) => !query || item.productName.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Supply validation"
        title="供给验证"
        description="围绕候选商品比较真实供给样本，并把结果带回机会判断。"
      >
        <button className="button secondary" type="button" onClick={() => void authorize("taobao")}>
          <Store size={16} />
          连接淘宝授权
        </button>
        <button className="button primary" type="button" onClick={() => void authorize("1688")}>
          <Store size={16} />
          连接 1688 授权
        </button>
      </PageHeading>
      <form
        className="supply-search"
        onSubmit={(event) => {
          event.preventDefault();
          void searchSupply();
        }}
      >
        <div>
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索候选商品或 1688 关键词"
          />
        </div>
        <button className="button primary" type="submit" disabled={searching}>
          {searching ? "搜索中" : "搜索实时供给"}
        </button>
      </form>
      {searchError && (
        <div className="notice notice-error" role="alert">
          <AlertTriangle size={17} />
          <span>{searchError}</span>
        </div>
      )}
      {searchResult && (
        <section className="panel">
          <SectionTitle
            title={`实时搜索结果 · ${searchResult.productName}`}
            subtitle={
              searchResult.origin === "live"
                ? "来自已连接的真实供给数据"
                : "真实接口暂不可用，当前结果明确标记为 Seed 回退"
            }
          />
          <div className="supply-card-head">
            <DataState live={searchResult.origin === "live"} liveText="真实供给" fallbackText="Seed 回退" />
            {searchResult.sourceUrl && (
              <a className="button ghost" href={searchResult.sourceUrl} target="_blank" rel="noreferrer">
                查看来源 <ArrowUpRight size={14} />
              </a>
            )}
          </div>
          <div className="supply-metrics">
            <div>
              <span>{searchResult.supplierCountIsSample ? "样本供应商" : "供应商"}</span>
              <strong>{searchResult.supplierCount}</strong>
            </div>
            <div>
              <span>价格区间</span>
              <strong>
                ¥{searchResult.minPriceCny}–{searchResult.maxPriceCny}
              </strong>
            </div>
            <div>
              <span>MOQ</span>
              <strong>{searchResult.moq}</strong>
            </div>
            <div>
              <span>交期</span>
              <strong>{searchResult.leadTimeDays} 天</strong>
            </div>
          </div>
        </section>
      )}
      {comparisonIds.length > 0 && <div className="notice">已加入 {comparisonIds.length} 个候选商品进行对比</div>}
      <section className="supply-grid">
        {items.map((item) => (
          <article className="supply-card" key={item.id}>
            <div className="supply-card-head">
              <div className="product-placeholder">
                <PackageSearch size={25} />
              </div>
              <div>
                <strong>{item.productName}</strong>
                <span>
                  {item.market} · {item.category}
                </span>
              </div>
              <DataState live={item.supply.origin === "live"} liveText="1688 实时" fallbackText="Seed 回退" />
            </div>
            <div className="supply-metrics">
              <div>
                <span>{item.supply.supplierCountIsSample ? "样本供应商" : "供应商"}</span>
                <strong>{item.supply.origin === "live" ? item.supply.supplierCount : "待验证"}</strong>
              </div>
              <div>
                <span>价格区间</span>
                <strong>
                  {item.supply.origin === "live" ? `¥${item.supply.minPriceCny}–${item.supply.maxPriceCny}` : "待验证"}
                </strong>
              </div>
              <div>
                <span>MOQ</span>
                <strong>{item.supply.moq || "待详情"}</strong>
              </div>
              <div>
                <span>交期</span>
                <strong>{item.supply.leadTimeDays ? `${item.supply.leadTimeDays} 天` : "待详情"}</strong>
              </div>
            </div>
            <div className="tag-row">
              {item.supply.complianceTags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <div className="card-action-row">
              <button className="button secondary" type="button" onClick={() => toggleComparison(item.id)}>
                {comparisonIds.includes(item.id) ? "移出比较" : "加入比较"}
              </button>
              <button className="button primary" type="button" onClick={() => onSelect(item)}>
                查看机会
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function SourcesPage({
  dashboard,
  onShowCollection
}: {
  dashboard: CollectionDashboard | null;
  onShowCollection: () => void;
}) {
  const [tested, setTested] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, CollectionChannelSummary>>({});
  const [integrationStatuses, setIntegrationStatuses] = useState<
    Partial<Record<CommerceIntegration, IntegrationAuthorizationStatus>>
  >({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const channels = (dashboard?.channels ?? []).map((channel) => sourceOverrides[channel.id] ?? channel);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchIntegrationStatus("taobao", controller.signal),
      fetchIntegrationStatus("1688", controller.signal)
    ])
      .then(([taobao, alibaba1688]) => {
        setIntegrationStatuses({ taobao, "1688": alibaba1688 });
        setStatusError(null);
      })
      .catch((statusLoadError) => {
        if (!(statusLoadError instanceof DOMException && statusLoadError.name === "AbortError")) {
          setStatusError(statusLoadError instanceof Error ? statusLoadError.message : "授权状态读取失败");
        }
      });
    return () => controller.abort();
  }, []);

  const testConnection = async (sourceId: string) => {
    setTesting(sourceId);
    setTestError(null);
    try {
      const result = await testSourceRequest(sourceId);
      setSourceOverrides((current) => ({ ...current, [sourceId]: result }));
      setTested(sourceId);
    } catch (error) {
      setTestError(presentBusinessError(error, "数据源连接测试失败，请稍后重试"));
    } finally {
      setTesting(null);
    }
  };
  const authorizeIntegration = async (integration: CommerceIntegration) => {
    setTestError(null);
    try {
      await beginIntegrationAuthorization(integration);
    } catch (error) {
      setTestError(presentBusinessError(error, "暂时无法发起平台授权"));
    }
  };
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Data connections"
        title="数据源"
        description="管理趋势、供给与销售数据连接，清楚识别每项数据的来源风险。"
      />
      {testError && (
        <div className="notice notice-error" role="alert">
          <AlertTriangle size={17} />
          <span>{testError}</span>
        </div>
      )}
      {statusError && (
        <div className="notice notice-error" role="alert">
          <AlertTriangle size={17} />
          <span>{statusError}</span>
        </div>
      )}
      <section className="source-connection-grid">
        {channels.map((item) => {
          const integration = commerceIntegrationForSource(item.id);
          const integrationStatus = integration ? integrationStatuses[integration] : undefined;
          return (
            <article className="source-connection" key={item.id}>
              <div className="source-logo">{sourceIcon(item.id)}</div>
              <div className="source-title">
                <div>
                  <strong>{item.label}</strong>
                  <span>{sourceRole(item.id)}</span>
                </div>
                <StatusBadge ok={item.ok} />
              </div>
              <p>{item.description}</p>
              <dl>
                <div>
                  <dt>来源类型</dt>
                  <dd>
                    {item.id.includes("1688") || item.id.includes("taobao") || item.id.includes("google")
                      ? "官方 / 授权"
                      : "第三方 / 聚合"}
                  </dd>
                </div>
                <div>
                  <dt>风险等级</dt>
                  <dd>
                    <RiskBadge risk={item.riskLevel ?? "medium"} />
                  </dd>
                </div>
                <div>
                  <dt>凭证状态</dt>
                  <dd>{credentialStatusText(item, integration, integrationStatus)}</dd>
                </div>
                <div>
                  <dt>最近测试</dt>
                  <dd>
                    {testing === item.id
                      ? "正在检测"
                      : tested === item.id
                        ? "刚刚通过"
                        : formatTime(item.lastCheckedAt)}
                  </dd>
                </div>
                <div>
                  <dt>今日数据</dt>
                  <dd>{item.rawCount > 0 ? `${item.rawCount} 条` : "暂无数据"}</dd>
                </div>
                <div>
                  <dt>数据新鲜度</dt>
                  <dd>
                    {item.freshnessStatus === "fresh"
                      ? `${item.freshnessMinutes ?? 0} 分钟前`
                      : item.freshnessStatus === "stale"
                        ? `已过期（${item.freshnessMinutes ?? 0} 分钟）`
                        : "尚未采集"}
                  </dd>
                </div>
                <div>
                  <dt>有效商业证据</dt>
                  <dd>
                    {item.purpose === "discovery"
                      ? `${item.mappedCount} 条商品映射`
                      : item.purpose === "validation"
                        ? `${item.validationCount} 条验证样本`
                        : "演示数据不计入"}
                  </dd>
                </div>
              </dl>
              {item.error && (
                <div className="connection-error">
                  <AlertTriangle size={15} />
                  {presentBusinessError(item.error, "最近一次采集未成功，请稍后重试")}
                </div>
              )}
              <div className="card-action-row">
                {integration && !integrationStatus ? (
                  <button type="button" className="button secondary" disabled>
                    读取授权状态
                  </button>
                ) : integration && !integrationStatus?.authorized ? (
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => void authorizeIntegration(integration)}
                  >
                    连接授权
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void testConnection(item.id)}
                    disabled={testing !== null}
                  >
                    {testing === item.id ? "检测中" : "测试连接"}
                  </button>
                )}
                {integration && integrationStatus?.authorized && (
                  <button className="button ghost" type="button" onClick={() => void authorizeIntegration(integration)}>
                    重新授权
                  </button>
                )}
                <button type="button" className="button ghost" onClick={onShowCollection}>
                  采集记录
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function commerceIntegrationForSource(sourceId: string): CommerceIntegration | null {
  if (sourceId.includes("taobao")) return "taobao";
  if (sourceId.includes("1688")) return "1688";
  return null;
}

function credentialStatusText(
  source: CollectionChannelSummary,
  integration: CommerceIntegration | null,
  status?: IntegrationAuthorizationStatus
) {
  if (integration) {
    if (!status) return "正在读取授权状态";
    if (!status.configured) return "应用尚未配置";
    if (!status.authorized)
      return status.error ? presentBusinessError(status.error, "账号授权已失效，请重新授权") : "等待账号授权";
    const refresh = status.refreshAvailable ? "，可自动刷新" : "";
    const proxy = integration === "1688" && status.proxyConfigured ? "；代理已配置" : "";
    return `已授权${refresh}${proxy}`;
  }
  if (source.id.includes("amazon")) return source.ok ? "已配置并验证" : "尚未配置或验证失败";
  return "已脱敏配置";
}

function TasksPage({
  opportunities,
  onSelect
}: {
  opportunities: ProductOpportunity[];
  onSelect: (item: ProductOpportunity) => void;
}) {
  const [view, setView] = useState<"board" | "list">("board");
  const columns: Array<{ label: string; statuses: OpportunityStatus[] }> = [
    { label: "待验证", statuses: ["new", "watching", "follow_up"] },
    { label: "验证中", statuses: ["verifying"] },
    { label: "打样中", statuses: ["sampling"] },
    { label: "已结束", statuses: ["listed", "rejected"] }
  ];
  const total = Math.max(1, opportunities.length);
  const fullyVerified = opportunities.filter((item) => item.evidence.stage === "actionable").length;
  const samplingOrLater = opportunities.filter((item) => ["sampling", "listed"].includes(item.status)).length;
  const listed = opportunities.filter((item) => item.status === "listed").length;
  const unassigned = opportunities.filter((item) => !item.owner).length;
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Execution & review"
        title="任务与复盘"
        description="把机会验证、询价、打样和上架推进成可追踪的经营动作。"
      >
        <div className="segmented">
          <button className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}>
            看板
          </button>
          <button className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>
            列表
          </button>
        </div>
      </PageHeading>
      <section className="kpi-grid compact">
        <Kpi
          label="双验证通过率"
          value={Math.round((fullyVerified / total) * 100)}
          suffix="%"
          note="供给与销售均已验证"
          icon={<CheckCircle2 size={19} />}
          tone="positive"
        />
        <Kpi
          label="打样率"
          value={Math.round((samplingOrLater / total) * 100)}
          suffix="%"
          note="当前机会进入打样"
          icon={<Factory size={19} />}
        />
        <Kpi
          label="上架率"
          value={Math.round((listed / total) * 100)}
          suffix="%"
          note="当前机会完成上架"
          icon={<Store size={19} />}
        />
        <Kpi label="待分配任务" value={unassigned} suffix="项" note="需要指定负责人" icon={<Clock3 size={19} />} />
      </section>
      {view === "board" ? (
        <section className="task-board">
          {columns.map((column) => {
            const items = opportunities.filter((item) => column.statuses.includes(item.status));
            return (
              <div className="task-column" key={column.label}>
                <div>
                  <strong>{column.label}</strong>
                  <span>{items.length}</span>
                </div>
                {items.slice(0, 4).map((item) => {
                  const priority = item.scores.overall >= 75 ? 0 : item.scores.overall >= 55 ? 1 : 2;
                  return (
                    <button type="button" className="task-card" key={item.id} onClick={() => onSelect(item)}>
                      <span className={`priority priority-${priority}`}>
                        {priority === 0 ? "高优" : priority === 1 ? "中优" : "普通"}
                      </span>
                      <strong>{item.productName}</strong>
                      <small>{item.analysis.nextBestAction}</small>
                      <div>
                        <span className="owner-avatar">{initials(item.owner ?? "选品")}</span>
                        <span>{item.dueDate ?? "待安排"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </section>
      ) : (
        <section className="panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>关联机会</th>
                  <th>负责人</th>
                  <th>截止时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.analysis.nextBestAction}</strong>
                    </td>
                    <td>
                      <button className="text-button" onClick={() => onSelect(item)}>
                        {item.productName}
                      </button>
                    </td>
                    <td>{item.owner ?? "未指派"}</td>
                    <td>{item.dueDate ?? "本周五"}</td>
                    <td>
                      <span className="status-pill">{statusLabels[item.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function EvidenceStage({ opportunity }: { opportunity: ProductOpportunity }) {
  return (
    <span className={`stage-badge stage-${opportunity.evidence.stage}`}>{stageLabels[opportunity.evidence.stage]}</span>
  );
}
function ChannelCard({
  channel,
  active,
  onClick
}: {
  channel: CollectionChannelSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`channel-card ${active ? "is-active" : ""}`} onClick={onClick}>
      <div>
        <span className={`channel-status ${channel.ok ? "is-ok" : "is-failed"}`} />
        <strong>{channel.label}</strong>
        <small>{channel.ok ? "采集完成" : "需要处理"}</small>
      </div>
      <p>{channel.description}</p>
      <div className="channel-counts">
        <span>
          <b>{channel.rawCount}</b>原始
        </span>
        <span>
          <b>{channel.mappedCount}</b>进入
        </span>
        <span>
          <b>{channel.filteredCount}</b>过滤
        </span>
      </div>
      <footer>
        <span>{formatTime(channel.lastCheckedAt)}</span>
        <RiskBadge risk={channel.riskLevel ?? "medium"} />
      </footer>
      {channel.error && <em>{presentBusinessError(channel.error, "最近一次采集未成功，请稍后重试")}</em>}
    </button>
  );
}

function DecisionBlock({
  label,
  text,
  icon,
  tone = "default"
}: {
  label: string;
  text: string;
  icon: React.ReactNode;
  tone?: "default" | "primary" | "warning" | "positive";
}) {
  return (
    <article className={`decision-block tone-${tone}`}>
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <strong>{text}</strong>
    </article>
  );
}
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function EvidenceTimeline({ opportunity }: { opportunity: ProductOpportunity }) {
  const items = opportunity.trendSignals.length
    ? opportunity.trendSignals.slice(0, 4).map((signal) => ({
        name: signal.origin === "seed" ? "Seed 演示证据" : (signal.sourcePlatform ?? signal.source),
        text: signal.evidence,
        live: signal.origin === "live"
      }))
    : [{ name: "趋势发现", text: "等待今日真实趋势信号", live: false }];
  return (
    <div className="evidence-timeline">
      {items.map((item, index) => (
        <div key={`${item.name}-${index}`}>
          <span className={item.live ? "is-live" : ""}>{index + 1}</span>
          <div>
            <strong>{item.name}</strong>
            <p>{item.text}</p>
            <small>{item.live ? "实时证据" : "待验证"}</small>
          </div>
        </div>
      ))}
      <div>
        <span className={opportunity.supply.origin === "live" ? "is-live" : ""}>{items.length + 1}</span>
        <div>
          <strong>1688 供给验证</strong>
          <p>
            {opportunity.supply.origin === "live"
              ? `${supplierCountText(opportunity.supply)}，¥${opportunity.supply.minPriceCny}–${opportunity.supply.maxPriceCny}`
              : "真实供给尚未接入"}
          </p>
          <small>{opportunity.supply.origin === "live" ? "实时证据" : "待验证"}</small>
        </div>
      </div>
      <div>
        <span className={opportunity.sales.origin === "live" ? "is-live" : ""}>{items.length + 2}</span>
        <div>
          <strong>Amazon 销售验证</strong>
          <p>
            {opportunity.sales.origin === "live"
              ? `${opportunity.sales.competitorCount} 个竞品样本`
              : "尚未连接真实销量、价格和评论数据"}
          </p>
          <small>{opportunity.sales.origin === "live" ? "实时证据" : "待接入"}</small>
        </div>
      </div>
    </div>
  );
}

function ValidationGate({ opportunity }: { opportunity: ProductOpportunity }) {
  const gates = [
    ["趋势来源", opportunity.evidence.liveTrendSources > 0, `${opportunity.evidence.liveTrendSources} 个实时来源`],
    ["真实供给", opportunity.evidence.supplyVerified, opportunity.evidence.supplyVerified ? "已验证" : "待验证"],
    ["真实销售", opportunity.evidence.salesVerified, opportunity.evidence.salesVerified ? "已验证" : "待接入"],
    ["证据完整度", opportunity.evidence.completeness >= 70, `${opportunity.evidence.completeness}%`]
  ] as const;
  return (
    <div className="validation-gates">
      {gates.map(([label, passed, detail]) => (
        <div key={label}>
          <span className={passed ? "is-passed" : ""}>
            {passed ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
          </span>
          <div>
            <strong>{label}</strong>
            <small>{detail}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidenceRecords({ opportunity }: { opportunity: ProductOpportunity }) {
  return (
    <section className="panel">
      <SectionTitle title="原始证据" subtitle="保留每条信号的来源、方法和采集时间" />
      <div className="evidence-record-list">
        {opportunity.trendSignals.map((signal) => (
          <article key={signal.id}>
            <div>
              <DataState live={signal.origin === "live"} liveText="实时" fallbackText="Seed" />
              <strong>{signal.origin === "seed" ? "Seed 演示证据" : signal.source}</strong>
              <span>{signal.market}</span>
            </div>
            <h3>{signal.sourceTopic ?? signal.keyword}</h3>
            <p>{signal.evidence}</p>
            <small>
              {signal.methodology} · {formatTime(signal.retrievedAt)}
            </small>
          </article>
        ))}
        {opportunity.trendSignals.length === 0 && (
          <EmptyState
            icon={<Activity size={24} />}
            title="暂无原始趋势证据"
            description="下一轮采集完成后会在这里保留原始返回。"
          />
        )}
      </div>
    </section>
  );
}
function SupplyDetail({ opportunity }: { opportunity: ProductOpportunity }) {
  return (
    <section className="panel">
      <SectionTitle
        title="1688 供给样本"
        subtitle={opportunity.supply.origin === "live" ? "来自授权 API 的实时结果" : "当前为回退数据，不进入已验证结论"}
      />
      <div className="supply-summary">
        <div>
          <span>{opportunity.supply.supplierCountIsSample ? "样本供应商" : "供应商"}</span>
          <strong>{opportunity.supply.origin === "live" ? opportunity.supply.supplierCount : "待验证"}</strong>
        </div>
        <div>
          <span>价格区间</span>
          <strong>
            {opportunity.supply.origin === "live"
              ? `¥${opportunity.supply.minPriceCny}–${opportunity.supply.maxPriceCny}`
              : "待验证"}
          </strong>
        </div>
        <div>
          <span>起订量</span>
          <strong>{opportunity.supply.moq || "待详情核验"}</strong>
        </div>
        <div>
          <span>交期</span>
          <strong>{opportunity.supply.leadTimeDays ? `${opportunity.supply.leadTimeDays} 天` : "待详情核验"}</strong>
        </div>
      </div>
      <div className="tag-row">
        {opportunity.supply.complianceTags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </section>
  );
}
function ValidationHistory({ opportunity }: { opportunity: ProductOpportunity }) {
  return (
    <section className="panel">
      <SectionTitle title="验证记录" subtitle="供给、销售与人工判断的推进历史" />
      <div className="activity-list">
        <div>
          <CheckCircle2 size={17} />
          <div>
            <strong>机会已进入{stageLabels[opportunity.evidence.stage]}阶段</strong>
            <span>{formatTime(opportunity.updatedAt)}</span>
          </div>
        </div>
        {opportunity.feedbackHistory.map((item) => (
          <div key={item.createdAt}>
            <Activity size={17} />
            <div>
              <strong>
                {statusLabels[item.action === "useful" || item.action === "not_useful" ? "watching" : item.action]}
              </strong>
              <span>
                {item.note ?? "无备注"} · {formatTime(item.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
function ActivityLog({ opportunity }: { opportunity: ProductOpportunity }) {
  return (
    <section className="panel">
      <SectionTitle title="操作日志" subtitle="系统采集和人工动作的审计轨迹" />
      <div className="activity-list">
        <div>
          <Database size={17} />
          <div>
            <strong>机会数据已刷新</strong>
            <span>{formatTime(opportunity.updatedAt)}</span>
          </div>
        </div>
        <div>
          <Target size={17} />
          <div>
            <strong>系统生成机会假设</strong>
            <span>{opportunity.analysis.hypothesis}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ManualOpportunityDialog({
  onClose,
  onCreate
}: {
  onClose: () => void;
  onCreate: (input: ManualOpportunityInput) => Promise<void>;
}) {
  const [form, setForm] = useState<ManualOpportunityInput>({
    productName: "",
    market: "CN",
    category: "outdoor",
    eventName: "",
    demand: "",
    reason: "",
    timeWindow: "2-4 周",
    nextAction: ""
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof ManualOpportunityInput, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    if (!form.productName.trim() || !form.eventName.trim() || !form.demand.trim() || form.reason.trim().length < 4) {
      setError("请完整填写商品、事件、需求和判断依据");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCreate(form);
    } catch (createError) {
      setError(presentBusinessError(createError, "人工机会创建失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="新建人工机会">
      <button className="modal-scrim" type="button" onClick={onClose} aria-label="关闭弹窗" />
      <div className="modal-card manual-opportunity-modal">
        <div className="modal-head">
          <div>
            <strong>新建人工机会</strong>
            <span>人工录入只生成待验证假设，不会绕过真实供给与销售证据门槛</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="manual-form-grid">
          <label>
            商品名称
            <input
              value={form.productName}
              onChange={(event) => update("productName", event.target.value)}
              placeholder="例如：折叠露营灯"
            />
          </label>
          <label>
            目标市场
            <select value={form.market} onChange={(event) => update("market", event.target.value)}>
              <option value="CN">中国</option>
              <option value="US">美国</option>
              <option value="EU">欧洲</option>
              <option value="GB">英国</option>
              <option value="AU">澳大利亚</option>
              <option value="SEA">东南亚</option>
            </select>
          </label>
          <label>
            商品类目
            <select value={form.category} onChange={(event) => update("category", event.target.value)}>
              <option value="outdoor">户外</option>
              <option value="small-appliance">小家电</option>
              <option value="pet">宠物</option>
              <option value="auto">汽车用品</option>
              <option value="general">其他</option>
            </select>
          </label>
          <label>
            机会窗口
            <input value={form.timeWindow ?? ""} onChange={(event) => update("timeWindow", event.target.value)} />
          </label>
          <label className="is-wide">
            事件名称
            <input
              value={form.eventName}
              onChange={(event) => update("eventName", event.target.value)}
              placeholder="例如：北美露营季"
            />
          </label>
          <label className="is-wide">
            需求描述
            <input
              value={form.demand}
              onChange={(event) => update("demand", event.target.value)}
              placeholder="用户为什么现在需要它"
            />
          </label>
          <label className="is-wide">
            判断依据
            <textarea
              value={form.reason}
              onChange={(event) => update("reason", event.target.value)}
              placeholder="填写观察到的渠道、数据或业务事实"
            />
          </label>
          <label className="is-wide">
            下一步动作
            <input
              value={form.nextAction ?? ""}
              onChange={(event) => update("nextAction", event.target.value)}
              placeholder="例如：验证美国站真实销量与价格带"
            />
          </label>
        </div>
        {error && (
          <div className="notice notice-error">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? "创建中" : "创建待验证机会"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoringRubricDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    ["趋势强度", "45%", "增长、当前热度、来源置信度与多平台交叉验证"],
    ["供给能力", "15%", "真实供应商数量、MOQ、交期与价格区间"],
    ["商业化空间", "15%", "真实售价、采购成本与需求代理"],
    ["竞争空间", "10%", "真实竞品数量，竞争越低得分越高"],
    ["来源置信度", "10%", "官方程度与来源风险折损"],
    ["合规风险", "5%", "材质、认证和高风险标签"],
    ["证据完整度", "门槛", "真实供给与销售未接入时限制最终得分和阶段"]
  ];
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label="评分口径">
      <button className="modal-scrim" type="button" onClick={onClose} aria-label="关闭弹窗" />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <strong>商业机会评分口径</strong>
            <span>评分只用于候选排序，证据门槛决定能否进入可行动阶段</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="rubric-list">
          {rows.map(([label, weight, description]) => (
            <div key={label}>
              <strong>{label}</strong>
              <span>{weight}</span>
              <small>{description}</small>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button primary" type="button" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionDialog({
  kind,
  opportunity,
  onClose,
  onConfirm
}: {
  kind: "assign" | "sample";
  opportunity: ProductOpportunity;
  onClose: () => void;
  onConfirm: (metadata: Pick<FeedbackAction, "owner" | "dueDate" | "note">) => void;
}) {
  const [owner, setOwner] = useState(opportunity.owner ?? "选品负责人");
  const [dueDate, setDueDate] = useState(opportunity.dueDate ?? "");
  const [sampleCount, setSampleCount] = useState(3);
  const [note, setNote] = useState(
    kind === "sample" ? `验证 ${opportunity.productName} 的材质、合规、包装和真实交期。` : ""
  );
  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-modal="true"
      aria-label={kind === "sample" ? "创建打样任务" : "指派负责人"}
    >
      <button className="modal-scrim" type="button" onClick={onClose} aria-label="关闭弹窗" />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <strong>{kind === "sample" ? "创建打样任务" : "指派负责人"}</strong>
            <span>{opportunity.productName}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <label>
          负责人
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option>选品负责人</option>
            <option>供应链负责人</option>
            <option>经营分析师</option>
          </select>
        </label>
        <label>
          截止日期
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        {kind === "sample" && (
          <>
            <label>
              目标样本数
              <input
                type="number"
                value={sampleCount}
                min={1}
                onChange={(event) => setSampleCount(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <label>
              任务说明
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() =>
              onConfirm({
                owner,
                dueDate: dueDate || undefined,
                note: kind === "sample" ? `${note} 目标样本数：${sampleCount}。` : "负责人已更新"
              })
            }
          >
            {kind === "sample" ? "创建任务" : "确认指派"}
          </button>
        </div>
      </div>
    </div>
  );
}

function JsonDrawer({ record, onClose }: { record: CollectionRecord; onClose: () => void }) {
  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" type="button" onClick={onClose} aria-label="关闭详情" />
      <aside className="detail-drawer">
        <div className="drawer-head">
          <div>
            <span>Raw collection record</span>
            <strong>原始采集记录</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </div>
        <dl className="record-fields">
          <div>
            <dt>渠道</dt>
            <dd>{record.channel}</dd>
          </div>
          <div>
            <dt>平台</dt>
            <dd>{record.platform}</dd>
          </div>
          <div>
            <dt>国家</dt>
            <dd>{record.market ?? "未指定"}</dd>
          </div>
          <div>
            <dt>采集时间</dt>
            <dd>{record.collectedAt}</dd>
          </div>
          <div>
            <dt>处理结果</dt>
            <dd>
              <OutcomeBadge outcome={record.outcome} />
            </dd>
          </div>
        </dl>
        <h3>原始内容</h3>
        <p className="drawer-title">{record.title}</p>
        <h3>识别说明</h3>
        <p>{record.reason}</p>
        <h3>原始 JSON</h3>
        <pre>{JSON.stringify(record, null, 2)}</pre>
      </aside>
    </div>
  );
}
function ChannelDrawer({ channel, onClose }: { channel: CollectionChannelSummary; onClose: () => void }) {
  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" type="button" onClick={onClose} aria-label="关闭详情" />
      <aside className="detail-drawer">
        <div className="drawer-head">
          <div>
            <span>Channel detail</span>
            <strong>{channel.label}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </div>
        <StatusBadge ok={channel.ok} />
        <h3>数据获取流程</h3>
        <div className="channel-flow">
          <span>定时触发</span>
          <ChevronRight size={15} />
          <span>官方/授权接口</span>
          <ChevronRight size={15} />
          <span>原始记录</span>
          <ChevronRight size={15} />
          <span>商品意图识别</span>
        </div>
        <h3>运行参数</h3>
        <dl className="record-fields">
          <div>
            <dt>今日原始量</dt>
            <dd>{channel.rawCount}</dd>
          </div>
          <div>
            <dt>进入分析</dt>
            <dd>{channel.mappedCount}</dd>
          </div>
          <div>
            <dt>过滤记录</dt>
            <dd>{channel.filteredCount}</dd>
          </div>
          <div>
            <dt>最近运行</dt>
            <dd>{formatTime(channel.lastCheckedAt)}</dd>
          </div>
        </dl>
        {channel.error && (
          <>
            <h3>最近错误</h3>
            <div className="connection-error">
              <AlertTriangle size={15} />
              {presentBusinessError(channel.error, "最近一次采集未成功，请稍后重试")}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function channelLabel(channels: CollectionChannelSummary[], id: string) {
  return channels.find((item) => item.id === id)?.label ?? id;
}
function supplierCountText(supply: SupplySignal) {
  return supply.supplierCountIsSample
    ? `${supply.supplierCount} 家样本供应商（本次最多 ${supply.sampleSize ?? supply.supplierCount} 条）`
    : `${supply.supplierCount} 家供应商`;
}
function formatTime(value?: string) {
  if (!value) return "尚未运行";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(date);
}
function formatMetric(record: CollectionRecord) {
  if (record.metricLabel && record.metricValue !== undefined)
    return `${record.metricLabel} ${record.metricValue.toLocaleString()}`;
  if (record.rank !== undefined) return `排名 #${record.rank}`;
  return "--";
}
function initials(value: string) {
  return value === "未指派" ? "--" : value.slice(0, 2);
}
function sourceRole(id: string) {
  if (id.includes("1688")) return "供给验证";
  if (id.includes("amazon")) return "销售验证";
  if (id.includes("taobao")) return "主题发现";
  if (id.includes("google")) return "趋势发现与验证";
  return "社交与聚合热榜";
}
function sourceIcon(id: string) {
  if (id.includes("1688") || id.includes("taobao")) return <Store size={21} />;
  if (id.includes("google")) return <Globe2 size={21} />;
  if (id.includes("amazon")) return <CircleDollarSign size={21} />;
  return <Activity size={21} />;
}
