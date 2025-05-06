import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "@/lib/utils";
export const Input = ({ className, ...props }) => {
    return (_jsx("input", { className: cn("px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400", className), ...props }));
};
