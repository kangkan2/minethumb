export interface CanvasElement {
  id: string;
  type: 'image' | 'text';
  x: number;
  y: number;
  width?: number;
  height?: number;
  src?: string;
  text?: string;
  fontSize?: number;
  fill?: string;
  rotation?: number;
}

export interface CustomLayout {
  id: string;
  name: string;
  category?: string;
  elements: CanvasElement[];
}

const gameCategories = ['Minecraft', 'GTA V', 'Free Fire Max', 'PUBG', 'Gaming'];
const otherCategories = ['Real Life', 'Reaction', 'Challenge', 'Tutorial', 'Vlog'];
const allCategories = [...gameCategories, ...otherCategories];
const textColors = ['#ffffff', '#fbbf24', '#ef4444', '#10b981', '#3b82f6'];

const generatedLayouts: CustomLayout[] = Array.from({ length: 100 }).map((_, i) => {
  const category = allCategories[i % allCategories.length];
  const typeIndex = Math.floor(i / allCategories.length);
  const color = textColors[i % textColors.length];
  const isGame = gameCategories.includes(category);
  
  return {
    id: `viral-${i}`,
    name: `${category} Viral ${typeIndex + 1}`,
    category: isGame ? 'Games' : 'Other',
    elements: [
      {
        id: `bg-${i}`,
        type: 'image',
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        src: `https://picsum.photos/seed/${category.replace(/ /g, '')}${typeIndex}/1280/720`,
        rotation: 0
      },
      {
        id: `text1-${i}`,
        type: 'text',
        x: 50,
        y: 50,
        text: `${category.toUpperCase()}`,
        fontSize: 80,
        fill: color,
        rotation: -2
      },
      {
        id: `text2-${i}`,
        type: 'text',
        x: 50,
        y: 150,
        text: `EPIC MOMENT ${typeIndex + 1}`,
        fontSize: 100,
        fill: '#ffffff',
        rotation: 2
      }
    ]
  };
});

const viralPngLayouts: CustomLayout[] = [
  {
    id: 'png-red-arrow',
    name: 'Red Arrow Overlay',
    category: 'Viral PNGs',
    elements: [
      {
        id: 'arrow-1',
        type: 'image',
        x: 640,
        y: 360,
        width: 200,
        height: 200,
        src: 'https://cdn.pixabay.com/photo/2013/07/12/17/41/arrow-152261_1280.png',
        rotation: 45
      }
    ]
  },
  {
    id: 'png-vs-graphic',
    name: 'VS Graphic',
    category: 'Viral PNGs',
    elements: [
      {
        id: 'vs-1',
        type: 'text',
        x: 540,
        y: 260,
        text: 'VS',
        fontSize: 180,
        fill: '#ef4444',
        rotation: 0
      }
    ]
  },
  {
    id: 'png-shocked-emoji',
    name: 'Shocked Emoji',
    category: 'Viral PNGs',
    elements: [
      {
        id: 'emoji-1',
        type: 'image',
        x: 100,
        y: 100,
        width: 300,
        height: 300,
        src: 'https://cdn.pixabay.com/photo/2020/12/27/20/24/smile-5865208_1280.png',
        rotation: 0
      }
    ]
  }
];

export const viralLayouts: CustomLayout[] = [...generatedLayouts, ...viralPngLayouts];
