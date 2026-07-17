# ProofPack（完工证据包）研究说明

研究日期：2026-07-16。

## 结论

推荐探索一个与现有趋势雷达无关的独立项目：面向小型安装、维修和维保团队的“完工证据包”。技师在现场上传施工前/中/后照片并口述工作内容，系统在三分钟内生成结构化完工报告、遗留问题、材料摘要和客户确认页。

## 已核验事实

- CompanyCam 官方页面把按项目组织、带时间与地点信息的现场照片、前后对比和 PDF 照片报告作为核心能力，并称有 30,000+ 公司使用。该数字属于厂商自报。
- SafetyCulture 官方定价页提供检查与报告产品，Premium 年付价为每席位每月 24 美元，说明企业已为结构化现场记录付费。
- MaintainX 官方定价页提供工单、图片、签名、PDF/CSV 导出和自动分享报告等分层能力。
- Jobber 官方产品和定价页覆盖现场服务公司的排班、报价、开票、客户沟通和现场记录，说明“全套现场服务管理”已是成熟且拥挤的品类。
- 美国劳工统计局预计安装、维护和修理职业在 2024–2034 年的总体就业增长快于全部职业平均水平。该事实仅用于说明目标工作场景持续存在，不代表目标市场规模。

## 推断与边界

竞品证明了付费意愿，也证明不能再做一个全功能 FSM/CMMS。首个切口应严格限制为：不用迁移客户、排班和财务数据，只通过任务链接收集照片与语音，自动生成客户能确认、办公室能用于开票和归档的证据包。

AI 一期只负责转写、字段提取、缺项提醒和草稿生成，不判断施工质量，不声称照片具有法律效力，也不替代安全检查或专业验收。

## 评分方法

四个候选方向按五项 1–5 分评估：痛点频率 25%、已有付费市场 20%、四周 MVP 速度 20%、数据/授权独立性 20%、试点用户可触达性 15%。评分是探索判断，不是用户调研或市场统计。

## 公开来源

- CompanyCam photo documentation: https://companycam.com/photo-documentation
- CompanyCam pricing plan overview: https://companycam.com/resources/blog/companycam-pricing-plan-overview
- SafetyCulture pricing: https://safetyculture.com/pricing
- MaintainX pricing: https://www.getmaintainx.com/pricing
- Jobber pricing: https://www.getjobber.com/pricing/
- U.S. BLS Installation, Maintenance, and Repair Occupations: https://www.bls.gov/ooh/installation-maintenance-and-repair/
