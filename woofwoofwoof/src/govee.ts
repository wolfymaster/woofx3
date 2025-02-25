export default class Govee {
    private baseURL = 'https://openapi.api.govee.com/router/api/v1';

    private deviceSku = 'H619Z';
    private deviceId = 'E3:2F:60:74:F4:C0:8B:08';

    private ORIGINAL_RED_COLOR = 16711680;

    private colorMap = {
        // Basic colors
        black: [0, 0, 0],
        white: [255, 255, 255],
        red: [255, 0, 0],
        green: [0, 255, 0],
        blue: [0, 0, 255],
        yellow: [255, 255, 0],
        cyan: [0, 255, 255],
        magenta: [255, 0, 255],
        
        // Gray shades
        gray: [128, 128, 128],
        silver: [192, 192, 192],
        darkgray: [169, 169, 169],
        lightgray: [211, 211, 211],
        
        // Red variations
        darkred: [139, 0, 0],
        salmon: [250, 128, 114],
        coral: [255, 127, 80],
        crimson: [220, 20, 60],
        firebrick: [178, 34, 34],
        indianred: [205, 92, 92],
        lightcoral: [240, 128, 128],
        maroon: [128, 0, 0],
        ruby: [144, 12, 6],
        
        // Green variations
        darkgreen: [0, 100, 0],
        forestgreen: [34, 139, 34],
        limegreen: [50, 205, 50],
        lightgreen: [144, 238, 144],
        palegreen: [152, 251, 152],
        seagreen: [46, 139, 87],
        olive: [128, 128, 0],
        diarrheagreen: [63, 110, 46],

        // Blue variations
        navy: [0, 0, 128],
        darkblue: [0, 0, 139],
        royalblue: [65, 105, 225],
        steelblue: [70, 130, 180],
        skyblue: [135, 206, 235],
        lightblue: [173, 216, 230],
        powderblue: [176, 224, 230],
        
        // Purple/Pink variations
        purple: [128, 0, 128],
        indigo: [75, 0, 130],
        violet: [238, 130, 238],
        periwinkle: [204, 204, 255],
        orchid: [218, 112, 214],
        plum: [221, 160, 221],
        pink: [255, 192, 203],
        hotpink: [255, 105, 180],
        deeppink: [255, 20, 147],
        
        // Brown variations
        brown: [165, 42, 42],
        chocolate: [210, 105, 30],
        saddlebrown: [139, 69, 19],
        sandybrown: [244, 164, 96],
        peru: [205, 133, 63],
        sienna: [160, 82, 45],
        tan: [210, 180, 140],
        
        // Orange variations
        orange: [255, 165, 0],
        darkorange: [255, 140, 0],
        tomato: [255, 99, 71],
        
        // Other colors
        gold: [255, 215, 0],
        khaki: [240, 230, 140],
        turquoise: [64, 224, 208],
        teal: [0, 128, 128],
        beige: [245, 245, 220],
        ivory: [255, 255, 240],
        wheat: [245, 222, 179]
    };

    constructor() { }

    async setColor(r: number, g: number, b: number): Promise<void> {
        await this.makeRequest(`${this.baseURL}/device/control`, 'post', this.colorSettingRequest(this.rgbToColor(r, g, b)))
    }

    async reset(): Promise<void> {
        await this.makeRequest(`${this.baseURL}/device/control`, 'post', this.colorSettingRequest(this.ORIGINAL_RED_COLOR))
    }

    lookupColor(color: string): number[] {
        let key = color.toLowerCase().trim();
        return this.colorMap[key];
    }

    private rgbToColor(r: number, g: number, b: number): number {
        return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
    }

    private colorSettingRequest(value: number) {
        return {
            "requestId": "not-used",
            "payload": {
                "sku": this.deviceSku,
                "device": this.deviceId,
                "capability": {
                    "type": "devices.capabilities.color_setting",
                    "instance": "colorRgb",
                    "value": value
                }
            }
        }
    }

    private async makeRequest(url: string, method: string, body: any): Promise<void> {
        try {
            await fetch(url, {
                method,
                body: JSON.stringify(body),
                headers: {
                    'Govee-API-Key': process.env.GOVEE_API_KEY || '',
                    'Content-Type': 'application/json',
                }
            });
        } catch(err) {
            console.log(err);
        }   
    }
}
