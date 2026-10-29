export const DT = 1 / 60;
export const RADIUS = .65;
export const HEIGHT = 440;
export const COUNT = 10000;
export const PROFILE = [[-220,104],[-190,108],[-135,93],[-75,49],[-4,2.6],[4,2.6],[75,49],[135,93],[190,108],[220,104]];
export const outline = [...PROFILE.map(([y,x])=>[-x,y]), ...[...PROFILE].reverse().map(([y,x])=>[x,y])];
export function halfWidth(y) {
  for(let i=1;i<PROFILE.length;i++) {
    if(y<=PROFILE[i][0]) {
      const [a,x]=PROFILE[i-1], [b,z]=PROFILE[i];
      return x+(z-x)*(y-a)/(b-a);
    }
  }
  return PROFILE.at(-1)[1];
}
