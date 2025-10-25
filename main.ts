import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';

// 卡片数据接口
interface Card {
	id: string;
	clozeId: string;
	notePath: string;
	content: string;
	interval: number;
	repetitions: number;
	easeFactor: number;
	dueDate: Date;
	title: string;
}

// 复习统计接口
interface ReviewStats {
	totalReviewed: number;
	correctAnswers: number;
	streakDays: number;
	lastReviewDate: Date;
}

// 插件设置接口
interface SpacedRepetitionSettings {
	maxReviewsPerDay: number;
	clozePattern: string;
	reviewStartHour: number;
	reviewEndHour: number;
	enableKeyboardShortcuts: boolean;
	showProgressBar: boolean;
}

const DEFAULT_SETTINGS: SpacedRepetitionSettings = {
	maxReviewsPerDay: 50,
	clozePattern: "{{c(\\d+)::(.*?)}}",
	reviewStartHour: 6,
	reviewEndHour: 22,
	enableKeyboardShortcuts: true,
	showProgressBar: true
}

// 假数据
const MOCK_CARDS: Card[] = [
	{
		id: "card-1",
		clozeId: "c1",
		notePath: "物理学/相对论.md",
		title: "万物与虚无",
		content: `# 万物与虚无

## 宇宙的本质探索

- 人类对宇宙的认知之旅：从神创到万物
- 宇宙尺度的漫长孤寂：费米悖论、光速与时空体系
- 广义相对论-爱因斯坦(Albert Einstein)的理论认为{{c1::引力}}是时空弯曲的表现
- 核心思想：将引力等同于时空几何的弯曲

## 量子力学的奥秘

量子世界中，粒子的行为遵循着与宏观世界截然不同的规律。`,
		interval: 1,
		repetitions: 0,
		easeFactor: 2.5,
		dueDate: new Date()
	},
	{
		id: "card-2",
		clozeId: "c1", 
		notePath: "哲学/存在主义.md",
		title: "存在主义哲学",
		content: `# 存在主义哲学

## 核心观点

萨特认为{{c1::存在先于本质}}是存在主义的核心观点。

这意味着：
- 人首先存在，然后通过自己的选择和行动来定义自己的本质
- 没有预定的人性或目的
- 每个人都绝对的自由来创造自己的价值和意义

## 其他重要思想家

- 海德格尔：存在与时间
- 加缪：荒诞主义
- 克尔凯郭尔：个体性与焦虑`,
		interval: 3,
		repetitions: 1,
		easeFactor: 2.6,
		dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
	},
	{
		id: "card-3",
		clozeId: "c2",
		notePath: "计算机科学/算法.md", 
		title: "算法复杂度",
		content: `# 算法复杂度分析

## 时间复杂度

快速排序的平均时间复杂度是{{c2::O(n log n)}}，但最坏情况下是O(n²)。

## 空间复杂度

- 递归调用栈的深度影响空间复杂度
- 原地排序算法可以节省额外空间

## 常见算法复杂度

| 算法 | 最好 | 平均 | 最坏 |
|------|------|------|------|
| 快速排序 | O(n log n) | O(n log n) | O(n²) |
| 归并排序 | O(n log n) | O(n log n) | O(n log n) |`,
		interval: 7,
		repetitions: 2,
		easeFactor: 2.8,
		dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000)
	}
];

// 复习视图类
export class ReviewView extends ItemView {
	private currentCard: Card | null = null;
	private cardQueue: Card[] = [];
	private currentIndex = 0;
	private contentArea: HTMLElement;
	private feedbackArea: HTMLElement;
	private topBar: HTMLElement;
	private reviewedToday = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: SpacedRepetitionPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return "spaced-repetition-review";
	}

	getDisplayText(): string {
		return "间隔重复复习";
	}

	getIcon(): string {
		return "brain";
	}

	async onOpen() {
		// 初始化卡片队列
		this.cardQueue = [...MOCK_CARDS].filter(card => card.dueDate <= new Date());
		this.currentIndex = 0;

		// 创建 HTML 结构
		this.createReviewInterface();

		// 加载第一张卡片
		if (this.cardQueue.length > 0) {
			this.currentCard = this.cardQueue[0];
			await this.renderCard(this.currentCard);
		} else {
			this.showCompletionMessage();
		}

		// 绑定事件监听器
		this.addEventListeners();
	}

	private createReviewInterface() {
		const container = this.containerEl;
		container.empty();
		container.addClass('obsidian-plugin-container');

		// 创建顶部导航栏
		this.topBar = container.createDiv('top-bar');
		
		// 左侧控制区域
		const leftSection = this.topBar.createDiv('left-section');
		const backBtn = leftSection.createEl('button', { 
			cls: 'nav-btn back-btn',
			text: '‹'
		});
		backBtn.addEventListener('click', () => {
			this.close();
		});

		const cardCounter = leftSection.createDiv('card-counter');
		cardCounter.textContent = `${this.cardQueue.length - this.currentIndex} + ${this.reviewedToday}`;

		// 中间区域
		const centerSection = this.topBar.createDiv('center-section');
		const title = centerSection.createDiv('title');
		title.textContent = 'Flashcards';
		
		const breadcrumbs = centerSection.createDiv('breadcrumbs');

		// 右侧控制区域
		const rightSection = this.topBar.createDiv('right-section');
		const moreBtn = rightSection.createEl('button', {
			cls: 'nav-btn more-btn',
			text: '⋯'
		});

		// 创建下拉菜单
		const dropdown = rightSection.createDiv('dropdown-menu');
		dropdown.innerHTML = `
			<div class="dropdown-item">设置</div>
			<div class="dropdown-item">统计</div>
			<div class="dropdown-item">帮助</div>
		`;

		// 绑定下拉菜单事件
		moreBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			dropdown.classList.toggle('show');
		});

		// 点击其他地方关闭下拉菜单
		document.addEventListener('click', () => {
			dropdown.classList.remove('show');
		});

		// 创建主要内容区域
		this.contentArea = container.createDiv('content-area');

		// 创建底部反馈控制栏
		this.feedbackArea = container.createDiv('feedback-controls');
		
		const skipBtn = this.feedbackArea.createEl('button', {
			cls: 'feedback-btn skip-btn',
			text: 'Skip'
		});
		skipBtn.dataset.quality = '0';

		const forgotBtn = this.feedbackArea.createEl('button', {
			cls: 'feedback-btn forgot-btn', 
			text: 'Forgot'
		});
		forgotBtn.dataset.quality = '1';

		const rememberedBtn = this.feedbackArea.createEl('button', {
			cls: 'feedback-btn remembered-btn',
			text: 'Remembered'
		});
		rememberedBtn.dataset.quality = '3';
	}

	private async renderCard(card: Card) {
		if (!card) return;

		// 更新面包屑导航
		const breadcrumbs = this.topBar.querySelector('.breadcrumbs') as HTMLElement;
		const pathParts = card.notePath.split('/');
		breadcrumbs.innerHTML = pathParts.map(part => `<span>${part.replace('.md', '')}</span>`).join(' › ');

		// 清空内容区域
		this.contentArea.empty();

		// 创建文档标题
		const docTitle = this.contentArea.createDiv('document-title');
		docTitle.textContent = card.title;

		// 处理 Cloze 语法
		const processedContent = this.processClozeContent(card.content, card.clozeId);
		
		// 渲染 Markdown 内容
		const contentDiv = this.contentArea.createDiv('note-content');
		await MarkdownRenderer.render(this.app, processedContent, contentDiv, card.notePath, this);

		// 隐藏反馈按钮
		this.feedbackArea.removeClass('show');
	}

	private processClozeContent(content: string, activeClozeId: string): string {
		// 将 {{c1::内容}} 格式转换为带有特殊标记的 HTML
		const clozeRegex = /\{\{c(\d+)::(.*?)\}\}/g;
		
		return content.replace(clozeRegex, (match, clozeNum, clozeText) => {
			if (clozeNum === activeClozeId.replace('c', '')) {
				return `<span class="cloze is-hidden" data-cloze-id="${clozeNum}">${clozeText}</span>`;
			} else {
				return clozeText; // 其他 cloze 直接显示答案
			}
		});
	}

	private addEventListeners() {
		// 监听内容区域的点击事件
		this.contentArea.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.matches('.cloze.is-hidden')) {
				this.revealAnswer(target);
			}
		});

		// 监听反馈按钮点击
		this.feedbackArea.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.matches('.feedback-btn')) {
				const quality = parseInt(target.dataset.quality || '0');
				this.submitFeedback(quality);
			}
		});

		// 键盘快捷键
		this.containerEl.addEventListener('keydown', (event) => {
			if (event.key === ' ') {
				event.preventDefault();
				const hiddenCloze = this.contentArea.querySelector('.cloze.is-hidden') as HTMLElement;
				if (hiddenCloze) {
					this.revealAnswer(hiddenCloze);
				}
			} else if (event.key === '1') {
				this.submitFeedback(1);
			} else if (event.key === '2') {
				this.submitFeedback(0);
			} else if (event.key === '3') {
				this.submitFeedback(3);
			}
		});
	}

	private revealAnswer(clozeElement: HTMLElement) {
		clozeElement.removeClass('is-hidden');
		clozeElement.addClass('is-revealed');

		// 显示反馈按钮
		this.feedbackArea.addClass('show');
	}

	private async submitFeedback(quality: number) {
		if (!this.currentCard) return;

		// 更新卡片数据（简化的 SM-2 算法）
		this.updateCardSchedule(this.currentCard, quality);
		
		this.reviewedToday++;
		this.currentIndex++;

		// 更新卡片计数器
		const cardCounter = this.topBar.querySelector('.card-counter') as HTMLElement;
		cardCounter.textContent = `${this.cardQueue.length - this.currentIndex} + ${this.reviewedToday}`;

		// 加载下一张卡片
		if (this.currentIndex < this.cardQueue.length) {
			this.currentCard = this.cardQueue[this.currentIndex];
			await this.renderCard(this.currentCard);
		} else {
			this.showCompletionMessage();
		}
	}

	private updateCardSchedule(card: Card, quality: number) {
		// 简化的 SM-2 算法实现
		if (quality >= 3) {
			if (card.repetitions === 0) {
				card.interval = 1;
			} else if (card.repetitions === 1) {
				card.interval = 6;
			} else {
				card.interval = Math.round(card.interval * card.easeFactor);
			}
			card.repetitions++;
			card.easeFactor = card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
		} else {
			card.repetitions = 0;
			card.interval = 1;
		}

		if (card.easeFactor < 1.3) {
			card.easeFactor = 1.3;
		}

		card.dueDate = new Date(Date.now() + card.interval * 24 * 60 * 60 * 1000);
	}

	private showCompletionMessage() {
		this.contentArea.empty();
		const completeDiv = this.contentArea.createDiv('review-complete');
		
		const title = completeDiv.createEl('h2');
		title.textContent = '🎉 今日复习完成！';
		
		const stats = completeDiv.createDiv('stats');
		stats.innerHTML = `
			<p>今日复习卡片：<strong>${this.reviewedToday}</strong></p>
			<p>正确率：<strong>85%</strong></p>
			<p>连续复习天数：<strong>7</strong></p>
		`;

		const encouragement = completeDiv.createEl('p');
		encouragement.textContent = '坚持就是胜利！明天继续加油！';
		encouragement.style.marginTop = '20px';
		encouragement.style.fontStyle = 'italic';

		// 隐藏反馈按钮
		this.feedbackArea.removeClass('show');
	}

	async onClose() {
		// 清理资源
	}
}

export default class SpacedRepetitionPlugin extends Plugin {
	settings: SpacedRepetitionSettings;

	async onload() {
		await this.loadSettings();

		// 注册复习视图
		this.registerView(
			"spaced-repetition-review",
			(leaf) => new ReviewView(leaf, this)
		);

		// 添加侧边栏图标
		const ribbonIconEl = this.addRibbonIcon('brain', '开始复习', (evt: MouseEvent) => {
			this.activateReviewView();
		});
		ribbonIconEl.addClass('spaced-repetition-ribbon-class');

		// 添加命令
		this.addCommand({
			id: 'open-review-view',
			name: '开始间隔重复复习',
			callback: () => {
				this.activateReviewView();
			}
		});

		this.addCommand({
			id: 'create-cloze',
			name: '创建 Cloze 填空',
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				const selection = editor.getSelection();
				if (selection) {
					const clozeText = `{{c1::${selection}}}`;
					editor.replaceSelection(clozeText);
				} else {
					editor.replaceSelection('{{c1::}}');
					// 将光标移动到 }} 之前
					const cursor = editor.getCursor();
					editor.setCursor(cursor.line, cursor.ch - 2);
				}
			}
		});

		// 添加设置页面
		this.addSettingTab(new SpacedRepetitionSettingTab(this.app, this));

		console.log('间隔重复插件已加载');
	}

	async activateReviewView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType("spaced-repetition-review");

		if (leaves.length > 0) {
			// 如果已经有复习视图，激活它
			leaf = leaves[0];
		} else {
			// 创建新的复习视图
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: "spaced-repetition-review", active: true });
		}

		// 激活视图
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	onunload() {
		console.log('间隔重复插件已卸载');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SpacedRepetitionSettingTab extends PluginSettingTab {
	plugin: SpacedRepetitionPlugin;

	constructor(app: App, plugin: SpacedRepetitionPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('每日最大复习数量')
			.setDesc('设置每天最多复习多少张卡片')
			.addText(text => text
				.setPlaceholder('50')
				.setValue(this.plugin.settings.maxReviewsPerDay.toString())
				.onChange(async (value) => {
					this.plugin.settings.maxReviewsPerDay = parseInt(value) || 50;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Cloze 语法模式')
			.setDesc('设置 Cloze 填空的正则表达式模式')
			.addText(text => text
				.setPlaceholder('{{c(\\d+)::(.*?)}}')
				.setValue(this.plugin.settings.clozePattern)
				.onChange(async (value) => {
					this.plugin.settings.clozePattern = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('复习开始时间')
			.setDesc('设置每天开始复习的时间（24小时制）')
			.addText(text => text
				.setPlaceholder('6')
				.setValue(this.plugin.settings.reviewStartHour.toString())
				.onChange(async (value) => {
					this.plugin.settings.reviewStartHour = parseInt(value) || 6;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('复习结束时间')
			.setDesc('设置每天结束复习的时间（24小时制）')
			.addText(text => text
				.setPlaceholder('22')
				.setValue(this.plugin.settings.reviewEndHour.toString())
				.onChange(async (value) => {
					this.plugin.settings.reviewEndHour = parseInt(value) || 22;
					await this.plugin.saveSettings();
				}));
	}
}
