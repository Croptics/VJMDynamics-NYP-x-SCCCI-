import { createContext, useCallback, useContext, useState } from "react";

/**
 * Static English/Chinese dictionary for the app's UI copy (labels, buttons,
 * headings, table headers). Deliberately NOT a live translation API — only
 * strings written into DICT below are ever translated, so no user/delegate
 * data (names, statuses pulled from the backend, etc.) is ever sent anywhere.
 *
 * Usage: const { t } = useLang(); <h1>{t("Dashboard")}</h1>
 * Add a new page? Add its strings to DICT — nothing else to wire up.
 */

const LANG_KEY = "mg_lang";

const DICT = {
  // Sidebar / nav
  "Dashboard": "仪表盘",
  "Trips": "行程",
  "Documents": "文件",
  "Exceptions": "异常",
  "Chat assistant": "聊天助手",
  "Account control": "账户管理",
  "Log out": "登出",
  "Switch language": "切换语言",

  // Login
  "Sign in": "登录",
  "No one gets left behind.": "一个都不能少。",
  "Real-time delegation attendance for SCCCI overseas trips.": "实时掌握新加坡中华总商会海外团组的出勤情况。",
  "A Singapore Chinese Chamber of Commerce & Industry initiative": "新加坡中华总商会项目",
  "SCCCI secretariat & on-ground staff": "总商会秘书处与现场工作人员",
  "Staff ID": "员工编号",
  "Password": "密码",
  "Keep me signed in": "保持登录状态",
  "Forgot password?": "忘记密码？",
  "Sign in with Workpass": "使用 Workpass 登录",
  "By signing in, you accept the SCCCI data handling policy.": "登录即表示您同意总商会的数据处理政策。",
  "Signing in…": "登录中…",

  // Dashboard — overview
  "Active trip": "当前行程",
  "Live present / missing / unassigned visibility.": "实时查看出席、缺席与未分配人数。",
  "Refresh": "刷新",
  "Export": "导出",
  "Live · synced": "实时 · 已同步",
  "Overview": "总览",
  "Analytics": "数据分析",
  "Missing right now": "当前缺席",
  "Present": "已出席",
  "Unassigned": "未分配",
  "Open exceptions": "未处理异常",
  "No coach yet": "尚未分配车辆",
  "Coach status": "车辆状态",
  "coaches": "辆车",
  "Live activity": "实时动态",
  "No activity yet. Add or update a delegate to see events here.": "暂无动态。添加或更新代表信息后将在此显示。",
  "Reverse headcount — delegates who haven't boarded yet": "反向点名 — 尚未登车的代表",
  "missing": "人缺席",
  "of": "/",
  "Departure in": "距出发还有",
  "in last 5 mins": "过去 5 分钟内新增",
  "critical": "紧急",
  "normal": "普通",
  "required": "必填",
  "added": "已添加",
  "updated": "已更新",
  "removed": "已移除",
  "All delegates removed": "已删除全部代表",
  "you": "你",
  "All delegates": "所有代表",
  "Create, edit, and remove attendance records": "创建、编辑和删除出勤记录",
  "Delete all": "全部删除",
  "Add delegate": "添加代表",
  "No delegates yet.": "暂无代表。",
  "No delegates yet. Click": "暂无代表。点击",
  "to create your first record.": "以创建第一条记录。",
  "Delegate": "代表",
  "Coach": "车辆",
  "Last seen": "最后出现",
  "Status": "状态",
  "All in": "全部到齐",
  "Empty": "空闲",
  "boarded": "已登车",
  "Edit delegate": "编辑代表",
  "Full name": "姓名",
  "Select a coach…": "选择车辆…",
  "No coach (unassigned)": "无车辆（未分配）",
  "Last seen (optional)": "最后出现（可选）",
  "Mark as VIP": "标记为贵宾",
  "Cancel": "取消",
  "Save changes": "保存更改",
  "Missing": "缺席",
  "Review": "待复核",
  "Normal": "普通",
  "Critical": "紧急",
  "Low": "低",
  "Resolved": "已解决",
  "Open": "未处理",

  // Dashboard — Analytics tab
  "Attendance breakdown, coach load, and VIP visibility — live from the trip data.": "出勤分布、车辆负载与贵宾情况 — 实时行程数据。",
  "Customize": "自定义",
  "Visible widgets": "显示的图表",
  "Attendance breakdown": "出勤分布",
  "Coach load": "车辆负载",
  "VIP vs. non-VIP missing": "贵宾与非贵宾缺席对比",
  "Remaining capacity": "剩余名额",
  "Boarded": "已登车",
  "Nobody's missing right now.": "目前没有人缺席。",
  "Non-VIP": "非贵宾",
  "Couldn't reach the backend": "无法连接到后端服务",
  "Loading…": "加载中…",
  "AI Insights": "AI 洞察",
  "A short written summary of the current attendance snapshot.": "关于当前出勤状况的简短文字摘要。",
  "Tip: switch to your preferred language before generating — it won't be re-translated afterward.": "提示：请先切换到您需要的语言再生成 — 生成后不会自动翻译。",
  "Generate Insights": "生成洞察",
  "Generating…": "生成中…",
  "As of": "截至",
  "via local Ollama": "通过本地 Ollama",
  "via Claude": "通过 Claude",

  // Chat assistant
  "Assistant": "助手",
  "Trip assistant": "行程助手",
  "Conversational queries · live data · translation": "对话式查询 · 实时数据 · 翻译",
  "New chat": "新对话",
  "Search chats…": "搜索对话…",
  "Today": "今天",
  "Yesterday": "昨天",
  "Ready": "就绪",
  "Ask anything about the trip…": "询问关于此次行程的任何问题…",
  "Send": "发送",

  // Onboarding
  "Onboarding": "入职登记",
  "Document parsing": "文件解析",
  "Drop passport PDFs — AI extracts and populates the delegate list.": "拖入护照 PDF — AI 自动提取并填入代表名单。",
  "Drop files or click to upload": "拖放文件或点击上传",
  "PDF or scanned image · Max 20 files · 10 MB each": "PDF 或扫描图片 · 最多 20 个文件 · 每个不超过 10 MB",
  "Assign to trip": "分配至行程",
  "Select a trip…": "选择行程…",
  "Uploaded files appear here with their extraction status.": "上传的文件及其解析状态将显示在此处。",
  "Recently extracted": "最近提取",
  "Review and confirm before adding to the delegate list": "添加到代表名单前请先核实确认",
  "Edit all": "编辑全部",
  "Done editing": "完成编辑",
  "Confirm & add": "确认并添加",
  "Name": "姓名",
  "Passport": "护照",
  "Nationality": "国籍",
  "Expiry": "有效期",
  "Confidence": "识别可信度",

  // Trips / Exceptions / QR Check-in (scaffolds)
  "Trip management": "行程管理",
  "Trips & coaches": "行程与车辆",
  "Manage itineraries and reassign delegates between coaches on the fly.": "管理行程安排，随时调整代表所属车辆。",
  "Trip Booking & Dynamic Coach Management": "行程预订与动态车辆管理",
  "Itinerary editor and drag-and-drop coach reassignment board.": "行程编辑器与拖拽式车辆调度看板。",
  "Exception inbox": "异常收件箱",
  "Log and resolve on-site exceptions; critical alerts push to all staff.": "记录并处理现场异常；紧急警报将推送给所有工作人员。",
  "Exception Logging & QR Fallback": "异常记录与二维码备用方案",
  "Support-ticket inbox, critical-exception push, and manual override.": "支持工单收件箱、紧急异常推送及人工覆盖。",
  "Staff · mobile": "工作人员 · 移动端",
  "QR check-in": "二维码签到",
  "Primary high-speed check-in. Scan a delegate badge to board them.": "主要的高速签到方式，扫描代表证件即可登车。",
  "High-Speed QR Check-in": "高速二维码签到",
  "Camera scanner, offline queue, live headcount, and manual fallback.": "摄像头扫描、离线队列、实时人数统计及人工备用方案。",

  // Account control
  "Administration": "管理",
  "Create accounts and choose exactly what each one can do.": "创建账户，并为每个账户设定具体权限。",
  "New account": "新建账户",
  "Accounts": "账户",
  "total": "个",
  "Username": "用户名",
  "Access": "权限",
  "View only": "仅查看",
  "You": "你",
  "Edit account": "编辑账户",
  "display only": "仅显示",
  "leave blank to keep current": "留空以保留当前密码",
  "Access rights": "访问权限",
  "Create account": "创建账户",
  "Saving…": "保存中…",
  "No accounts yet.": "暂无账户。",
  "Manage delegates": "管理代表",
  "Add, edit and delete delegates (including delete all)": "添加、编辑和删除代表（包括全部删除）",
  "Export data": "导出数据",
  "Download the attendance report as Excel": "以 Excel 格式下载出勤报告",
  "Manage accounts": "管理账户",
  "Access Account control — create, edit and delete accounts": "访问账户管理 — 创建、编辑和删除账户",
  "At least 8 characters, including a letter and a number.": "至少 8 个字符，需包含字母和数字。",

  // Mobile
  "Home": "首页",
  "right now": "当前",
  "Everyone's accounted for. 🎉": "所有人都已到齐。🎉",
  "Ask about the trip": "咨询行程问题",
  "Try: \"Who is missing from Coach 2?\" or \"Generate an attendance report.\"": "试试问：「2 号车缺席谁？」或「生成一份出勤报告。」",
  "Thinking…": "思考中…",
  "Ask anything…": "输入任何问题…",
  "Profile": "个人资料",
  "Permissions": "权限",
  "No special permissions on this account.": "此账户没有特殊权限。",
  "Total": "总计",
};

const LangContext = createContext({ lang: "en", toggleLang: () => {}, t: (s) => s });

export function useLang() {
  return useContext(LangContext);
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(LANG_KEY) || "en";
    } catch {
      return "en";
    }
  });

  const toggleLang = useCallback(() => {
    setLang((l) => {
      const next = l === "en" ? "zh" : "en";
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const t = useCallback((s) => (lang === "zh" ? DICT[s] || s : s), [lang]);

  return <LangContext.Provider value={{ lang, toggleLang, t }}>{children}</LangContext.Provider>;
}
